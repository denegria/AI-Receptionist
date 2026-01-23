import WebSocket from 'ws';
import { DeepgramSTTService } from '../voice/stt';
import { DeepgramTTSService } from '../voice/tts';
import { config } from '../../config';
import { LLMService, ChatMessage } from '../ai/llm';
import { ToolExecutor } from '../ai/tool-executor';
import { callLogRepository } from '../../db/repositories/call-log-repository';
import { conversationTurnRepository } from '../../db/repositories/conversation-turn-repository';
import { loadClientConfig, ClientConfig } from '../../models/client-config';
import { fallbackService, FallbackLevel } from './fallback-service';
import { logger } from '../logging';
import { CallState, CallStateManager } from './call-state';

export class StreamHandler {
    private ws: WebSocket;
    private stt: DeepgramSTTService;
    private tts: DeepgramTTSService;
    private llm: LLMService;
    private toolExecutor: ToolExecutor;
    private history: ChatMessage[] = [];
    private clientId: string | null = null;
    private config: ClientConfig | null = null;
    private callSid: string = '';
    private streamSid: string = '';
    private turnCount: number = 0;
    private processingChain: Promise<void> = Promise.resolve();
    private mediaPacketCount: number = 0;
    private isAISpeaking: boolean = false;
    private shouldCancelPending: boolean = false;
    private inactivityTimeout?: NodeJS.Timeout;
    private callDurationTimeout?: NodeJS.Timeout; // Hard limit
    private stateManager: CallStateManager;
    private callerPhone: string = 'unknown';
    private currentAbortController: AbortController | null = null;
    private sentenceBuffer: string = '';
    private turnStartTime: number = 0;
    private speechQueue: string[] = [];
    private isProcessingQueue: boolean = false;

    private readonly SENTENCE_END_REGEX = /[.!?](\s|$)/;
    private readonly ABBREVIATION_REGEX = /\b(Dr|Mr|Mrs|Ms|St|Ave|Inc|Jr|Sr|Prof|gov|com|net|org|edu)\.$/i;

    private readonly INACTIVITY_LIMIT_MS = 30000; // 30 seconds
    private readonly MAX_HISTORY = 20;
    private readonly KEEP_RECENT = 10;

    constructor(ws: WebSocket, clientId?: string) {
        // ... (constructor remains similar, just initializing services)
        this.ws = ws;
        this.clientId = clientId || null;

        if (this.clientId && this.clientId !== 'default') {
            try {
                this.config = loadClientConfig(this.clientId);
            } catch (e) {
                console.warn(`Could not load initial config for ${this.clientId}:`, e);
            }
        }

        this.stateManager = new CallStateManager('pending');

        this.stt = new DeepgramSTTService();
        this.tts = new DeepgramTTSService();
        this.llm = new LLMService();
        this.toolExecutor = new ToolExecutor();

        this.setupSocket();
        this.setupSTT();

        // Safety: Hard limit on call duration
        this.callDurationTimeout = setTimeout(async () => {
            console.log('⏰ MAX DURATION REACHED - Force terminating call');
            await this.speak("I'm sorry, I have to end the call now as we've reached the system time limit. Goodbye.");
            setTimeout(() => this.ws.close(), 3000);
        }, config.voice.maxDurationMs);
    }

    private setupSocket() {
        this.ws.on('message', async (msg: string) => {
            // ... (message handling remains mostly the same)
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.error("[DEBUG] Invalid JSON from Twilio:", msg.substring(0, 100));
                return;
            }

            if (data.event === 'start') {
                this.streamSid = data.start.streamSid;
                this.callSid = data.start.callSid || `sim-${Date.now()}`;
                this.stateManager = new CallStateManager(this.callSid); // Re-init with real SID
                logger.info('Stream initialized', { callSid: this.callSid, streamSid: this.streamSid });

                if (data.start.customParameters?.callerPhone) {
                    this.callerPhone = data.start.customParameters.callerPhone;
                } else if (data.start.from) {
                    this.callerPhone = data.start.from;
                }

                if (data.start.customParameters?.clientId) {
                    this.clientId = data.start.customParameters.clientId;
                }
                if (!this.clientId) this.clientId = 'abc';

                try {
                    this.config = loadClientConfig(this.clientId);
                    // Create initial call log to avoid Foreign Key errors
                    callLogRepository.create({
                        client_id: this.clientId,
                        call_sid: this.callSid,
                        caller_phone: this.callerPhone,
                        call_direction: 'inbound',
                        call_status: 'initiated'
                    });
                } catch (e) {
                    console.error('Failed to load config or create log:', e);
                    this.ws.close();
                    return;
                }

                // Initial Greeting (State Transition)
                console.log(`✅ Config loaded for ${this.clientId}. Transitioning to GREETING.`);
                this.transitionTo(CallState.GREETING);
                await this.handleInitialGreeting();
            } else if (data.event === 'media') {
                if (data.media && data.media.payload) {
                    this.mediaPacketCount++;
                    const audio = Buffer.from(data.media.payload, 'base64');
                    this.stt.send(audio);
                }
            } else if (data.event === 'stop') {
                this.stt.stop();
                this.finalizeCall('completed');
                this.transitionTo(CallState.TERMINATED);
            }
        });

        this.ws.on('close', () => {
            this.stt.stop();
            if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
            if (this.callDurationTimeout) clearTimeout(this.callDurationTimeout);
            this.finalizeCall('completed');
            logger.info('Client disconnected from media stream', { callSid: this.callSid });
        });
    }

    private transitionTo(newState: CallState) {
        this.stateManager.transitionTo(newState);
    }

    private setupSTT() {
        this.stt.start(async (transcript, isFinal, confidence) => {
            if (isFinal && transcript.trim().length > 0) {
                this.shouldCancelPending = true;
                this.resetInactivityTimer();

                // Feature: Strict Confidence Gate
                if (confidence && confidence < config.voice.asrConfidenceThreshold) {
                    logger.warn(`STT Low Confidence`, { callSid: this.callSid, transcript, confidence });
                    // Minimal fallback prompt
                    this.enqueueSpeech("I'm sorry, the connection is a bit breaking up. Could you say that again?");
                    return;
                }

                // Logging
                this.turnStartTime = Date.now();
                logger.latency(this.callSid, 'STT_FINAL', 0, { transcript, confidence });

                console.log(`STT [FINAL]: ${transcript} (Confidence: ${confidence})`);
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                // Interruption Handling
                if (this.isAISpeaking || this.currentAbortController) {
                    this.shouldCancelPending = true;
                    this.sendClearSignal();

                    if (this.currentAbortController) {
                        this.currentAbortController.abort();
                        this.currentAbortController = null;
                        console.log('[DEBUG] 🛑 Aborted LLM/TTS Stream due to Interruption');
                    }
                }
            }
        }, () => {
            // Speech Started Event
            if (this.isAISpeaking || this.currentAbortController) {
                this.shouldCancelPending = true;
                this.sendClearSignal();
                if (this.currentAbortController) {
                    this.currentAbortController.abort();
                    this.currentAbortController = null;
                }
            }
        });
        this.resetInactivityTimer();
    }

    private resetInactivityTimer() {
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }

        this.inactivityTimeout = setTimeout(async () => {
            console.log('⏱️ Inactivity timeout - ending call');
            await this.speak("I haven't heard from you in a while. I'll end this call now. Feel free to call back!");
            setTimeout(() => this.ws.close(), 3000);
        }, this.INACTIVITY_LIMIT_MS);
    }

    private sendClearSignal() {
        const clearMessage = {
            event: 'clear',
            streamSid: this.streamSid
        };
        if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            console.log('[DEBUG] Sending CLEAR signal to stop AI speech');
            this.ws.send(JSON.stringify(clearMessage));
            this.isAISpeaking = false;
        }
    }

    private enqueueProcessing(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.processingChain = this.processingChain.then(() =>
            this.handleLLMResponse(role, content, tool_use_id)
        );
    }

    private async handleInitialGreeting() {
        if (!this.config) return;

        // Feature: Compliance Message (Softened)
        const complianceMsg = "Just so you know, this call might be recorded. ";
        const greeting = complianceMsg + (this.config.aiSettings.greeting || "Hi! How can I help you today?");

        this.history.push({ role: 'assistant', content: greeting });
        this.logTurn('assistant', greeting);

        await this.speak(greeting);
    }


    private async handleLLMResponse(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        if (role === 'user') this.shouldCancelPending = false;

        this.history.push({ role, content, tool_use_id });
        this.pruneHistory();

        if (this.shouldCancelPending && role !== 'user') return;
        if (role === 'user' && typeof content === 'string') this.logTurn('user', content);

        logger.latency(this.callSid, 'LLM_START', Date.now()); // Using Date.now for relative calc later if needed

        // --- STREAMING PATH ---
        if (config.features.enableStreamingLLM) {
            try {
                await this.handleStreamingResponse();
                return;
            } catch (e) {
                console.error('Streaming failed, falling back to legacy:', e);
                // Fallthrough to legacy
            }
        }

        // --- LEGACY PATH (Blocking) ---
        let retryCount = 0;
        const maxRetries = 1;

        while (retryCount <= maxRetries) {
            try {
                console.log(`[DEBUG] Sending to LLM (Blocking). Attempt: ${retryCount + 1}`);
                const response = await this.llm.generateResponse(this.history, {
                    businessName: this.config!.businessName,
                    timezone: this.config!.timezone
                });

                const assistantMessage = { role: 'assistant' as const, content: response.content };
                this.history.push(assistantMessage);

                for (const block of response.content) {
                    if (this.shouldCancelPending) break;

                    if (block.type === 'text') {
                        this.logTurn('assistant', block.text);
                        await this.speak(block.text);
                    } else if (block.type === 'tool_use') {
                        await this.handleToolCall(block);
                    }
                }
                break;

            } catch (error: any) {
                console.error(`LLM Error (Attempt ${retryCount + 1}):`, error);
                retryCount++;
                if (retryCount > maxRetries) {
                    await this.triggerFallback(error);
                }
            }
        }
    }

    private async handleStreamingResponse() {
        this.currentAbortController = new AbortController();
        const stream = this.llm.generateStream(this.history, {
            businessName: this.config!.businessName,
            timezone: this.config!.timezone
        });

        let assistantContent: any[] = [];
        let currentText = '';
        let isFirstToken = true;
        let currentTool: { id: string, name: string, input: string } | null = null;

        try {
            for await (const chunk of stream) {
                if (this.currentAbortController?.signal.aborted) throw new Error('Stream Aborted');

                if (chunk.type === 'message_start') {
                    // Init
                } else if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                    // If we had text before the tool, push it to content array
                    if (currentText) {
                        assistantContent.push({ type: 'text', text: currentText });
                        currentText = '';
                    }
                    currentTool = {
                        id: chunk.content_block.id,
                        name: chunk.content_block.name,
                        input: ''
                    };
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                    if (currentTool) {
                        currentTool.input += chunk.delta.partial_json;
                    }
                } else if (chunk.type === 'content_block_stop') {
                    if (currentTool) {
                        // Push tool_use to assistant content
                        assistantContent.push({
                            type: 'tool_use',
                            id: currentTool.id,
                            name: currentTool.name,
                            input: JSON.parse(currentTool.input)
                        });

                        // CRITICAL: Push Assistant message to history BEFORE executing tool
                        // This satisfies Anthropic's requirement that tool_result follows tool_use
                        this.history.push({ role: 'assistant', content: assistantContent });

                        try {
                            this.logTurn('assistant', `[TOOL CALL] ${currentTool.name}`);
                            const input = JSON.parse(currentTool.input);

                            // Execute tool (Blocking)
                            const result = await this.toolExecutor.execute(currentTool.name, input, this.clientId!);
                            this.logTurn('assistant', `[TOOL RESULT] ${currentTool.name}: ${result}`);

                            if (currentTool.name === 'book_appointment' && !result.includes('Error')) {
                                this.transitionTo(CallState.CONFIRMATION);
                            }

                            // Chain the tool result back into LLM
                            await this.handleLLMResponse('tool', result, currentTool.id);
                            currentTool = null;
                            return; // Stop processing this stream iteration
                        } catch (parseError) {
                            console.error('Failed to parse tool input:', parseError);
                        }
                    } else if (currentText) {
                        // Just finished a text block
                        assistantContent.push({ type: 'text', text: currentText });
                        currentText = '';
                    }
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    if (isFirstToken) {
                        logger.latency(this.callSid, 'LLM_FIRST_TOKEN', Date.now() - this.turnStartTime);
                        isFirstToken = false;
                    }

                    const text = chunk.delta.text;
                    currentText += text;
                    this.sentenceBuffer += text;

                    // Flush sentences
                    if (this.isSentenceComplete(this.sentenceBuffer)) {
                        const sentence = this.sentenceBuffer.trim();
                        this.sentenceBuffer = '';
                        if (sentence) {
                            logger.latency(this.callSid, 'TTS_FIRST_SENTENCE', Date.now() - this.turnStartTime, { sentence });
                            this.enqueueSpeech(sentence);
                        }
                    }
                }
            }

            // Flush remaining buffer
            if (this.sentenceBuffer.trim()) {
                this.enqueueSpeech(this.sentenceBuffer.trim());
                this.sentenceBuffer = '';
            }

            // If we finished without tools, finalize history
            if (currentText) assistantContent.push({ type: 'text', text: currentText });
            if (assistantContent.length > 0) {
                this.history.push({ role: 'assistant', content: assistantContent });
                // Log only the text parts for better readability in logs
                const fullText = assistantContent
                    .filter(b => b.type === 'text')
                    .map(b => b.text)
                    .join(' ');
                if (fullText) this.logTurn('assistant', fullText);
            }

        } catch (e: any) {
            if (e.message === 'Stream Aborted') {
                console.log('Stream explicitly aborted.');
            } else {
                throw e;
            }
        } finally {
            this.currentAbortController = null;
        }
    }

    private isSentenceComplete(text: string): boolean {
        const trimmed = text.trim();
        if (!this.SENTENCE_END_REGEX.test(trimmed)) return false;
        if (this.ABBREVIATION_REGEX.test(trimmed)) return false;
        return true;
    }

    private async handleToolCall(block: any) {
        this.logTurn('assistant', `[TOOL CALL] ${block.name}`);
        const result = await this.toolExecutor.execute(block.name, block.input, this.clientId!);
        this.logTurn('assistant', `[TOOL RESULT] ${block.name}: ${result}`);

        if (block.name === 'book_appointment' && !result.includes('Error')) {
            this.transitionTo(CallState.CONFIRMATION);
        }

        if (result === 'TRIGGER_VOICEMAIL_FALLBACK') {
            this.ws.close();
            return;
        }
        await this.handleLLMResponse('tool', result, block.id);
    }

    private async triggerFallback(error: any) {
        console.error('Triggering Fallback:', error);
        const fallbackResponse = await fallbackService.handleFallback(
            FallbackLevel.LEVEL_2_HARD,
            this.callSid,
            this.callerPhone,
            error.message
        );
        await this.speak(fallbackResponse);
        this.ws.close();
    }

    private logTurn(role: 'user' | 'assistant', content: string) {
        this.turnCount++;
        conversationTurnRepository.create({
            call_sid: this.callSid,
            turn_number: this.turnCount,
            role,
            content
        });
    }

    private pruneHistory() {
        if (this.history.length > this.MAX_HISTORY) {
            // Keep system messages (instructions) and the last N recent messages
            const systemMsgs = this.history.filter(m => m.role === 'system');
            const otherMsgs = this.history
                .filter(m => m.role !== 'system')
                .slice(-this.KEEP_RECENT);

            this.history = [...systemMsgs, ...otherMsgs];
            console.log(`🧹 Pruned history: ${systemMsgs.length} system + ${otherMsgs.length} recent`);
        }
    }

    private enqueueSpeech(text: string) {
        this.speechQueue.push(text);
        this.processSpeechQueue();
    }

    private async processSpeechQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.speechQueue.length > 0) {
            // Check if we should abort mid-queue (e.g. on barge-in)
            if (this.shouldCancelPending) {
                this.speechQueue = [];
                break;
            }

            const text = this.speechQueue.shift();
            if (text) {
                await this.speak(text);
            }
        }

        this.isProcessingQueue = false;
    }

    private finalizeCall(status: any) {
        if (this.inactivityTimeout) {
            clearTimeout(this.inactivityTimeout);
        }
        if (!this.callSid) return;
        callLogRepository.update(this.callSid, {
            call_status: status,
            call_duration: 0 // In real world, calculate diff from start
        });
    }

    private async speak(text: string) {
        try {
            this.isAISpeaking = true;
            console.log(`[DEBUG] Speaking: "${text}"`);

            if (config.features.enableStreamingTTS) {
                // Low-latency path: Process chunks as they arrive from Deepgram
                for await (const chunk of this.tts.generateStream(text)) {
                    if (this.shouldCancelPending) break;

                    const message = {
                        event: 'media',
                        streamSid: this.streamSid,
                        media: {
                            payload: chunk.toString('base64')
                        }
                    };

                    if (this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify(message));
                    }
                }
            } else {
                // Legacy path: Wait for full buffer
                const audioBuffer = await this.tts.generate(text);
                const payload = audioBuffer.toString('base64');
                const message = {
                    event: 'media',
                    streamSid: this.streamSid,
                    media: { payload }
                };

                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify(message));
                    // Estimate when speaking finishes
                    const estimatedDuration = (audioBuffer.length / 8000) * 1000;
                    await new Promise(resolve => setTimeout(resolve, estimatedDuration));
                }
            }
        } catch (error) {
            console.error('TTS Error:', error);
        } finally {
            this.isAISpeaking = false;
        }
    }
}
