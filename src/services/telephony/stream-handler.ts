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
    private currentSpeechAbort: AbortController | null = null;
    private currentTTSLive: { send: (t: string) => void, finish: () => void } | null = null;
    private turnStartTime: number = 0;

    private readonly SENTENCE_END_REGEX = /[.!?](\s|$)/;
    private readonly ABBREVIATION_REGEX = /\b(Dr|Mr|Mrs|Ms|St|Ave|Inc|Jr|Sr|Prof|gov|com|net|org|edu)\.$/i;

    private readonly INACTIVITY_LIMIT_MS = 30000; // 30 seconds
    private readonly MAX_HISTORY = 20;
    private readonly KEEP_RECENT = 10;

    constructor(ws: WebSocket, clientId?: string) {
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
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.error("[DEBUG] Invalid JSON from Twilio:", msg.toString().substring(0, 100));
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
                    callLogRepository.create({
                        client_id: this.clientId,
                        call_sid: this.callSid,
                        caller_phone: this.callerPhone,
                        call_direction: 'inbound',
                        call_status: 'initiated'
                    });
                } catch (e) {
                    console.error('Failed to load config:', e);
                    this.ws.close();
                    return;
                }

                console.log(`✅ Config loaded for ${this.clientId}. Transitioning to GREETING.`);
                this.transitionTo(CallState.GREETING);
                this.handleInitialGreeting().catch(err => console.error('[GREETING ERROR]', err));
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

                if (confidence && confidence < config.voice.asrConfidenceThreshold) {
                    logger.warn(`STT Low Confidence`, { callSid: this.callSid, transcript, confidence });
                    await this.speak("I'm sorry, the connection is a bit breaking up. Could you say that again?");
                    return;
                }

                this.turnStartTime = Date.now();
                logger.latency(this.callSid, 'STT_FINAL', 0, { transcript, confidence });

                console.log(`STT [FINAL]: ${transcript} (Confidence: ${confidence})`);
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                // Interruption Handling
                if (this.isAISpeaking || this.currentAbortController) {
                    const isSubstantialSpeech = transcript.trim().split(' ').length > 3;
                    const isConfidentSpeech = confidence && confidence > 0.7;

                    if (isSubstantialSpeech || isConfidentSpeech) {
                        this.shouldCancelPending = true;
                        this.sendClearSignal();

                        if (this.currentAbortController) {
                            this.currentAbortController.abort();
                            this.currentAbortController = null;
                        }
                    }
                }
            }
        }, () => {
            // Speech Started Event
            if (this.isAISpeaking || this.currentAbortController) {
                this.shouldCancelPending = true;
                this.sendClearSignal();
            }
        });
        this.resetInactivityTimer();
    }

    private resetInactivityTimer() {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(async () => {
            console.log('⏰ Inactivity timeout reached');
            if (this.stateManager.getState() !== CallState.TERMINATED) {
                await this.speak("I haven't heard from you in a while, so I'll go ahead and end the call. Feel free to call back if you still need help. Goodbye!");
                setTimeout(() => this.ws.close(), 5000);
            }
        }, this.INACTIVITY_LIMIT_MS);
    }

    private sendClearSignal() {
        const clearMessage = { event: 'clear', streamSid: this.streamSid };
        if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            console.log('[DEBUG] Sending CLEAR signal to stop AI speech');
            this.ws.send(JSON.stringify(clearMessage));
            this.isAISpeaking = false;

            if (this.currentSpeechAbort) {
                this.currentSpeechAbort.abort();
                this.currentSpeechAbort = null;
            }

            this.cleanupTTS();
        }
    }

    private ensureTTSSession() {
        if (this.currentTTSLive) return this.currentTTSLive;

        console.log('[DEBUG] 🚀 Opening NEW Interaction-level TTS Session...');
        const session = this.tts.createLiveSession((chunk) => {
            if (this.shouldCancelPending) return;
            const message = {
                event: 'media',
                streamSid: this.streamSid,
                media: { payload: chunk.toString('base64') }
            };
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(message));
            }
        });
        this.currentTTSLive = session;
        return session;
    }

    private cleanupTTS() {
        if (this.currentTTSLive) {
            console.log('[DEBUG] 🧹 Cleaning up active TTS Session');
            this.currentTTSLive.finish();
            this.currentTTSLive = null;
        }
    }

    private async speakREST(text: string) {
        if (!text.trim()) return;
        if (this.currentSpeechAbort) this.currentSpeechAbort.abort();
        this.currentSpeechAbort = new AbortController();
        const signal = this.currentSpeechAbort.signal;

        try {
            console.log(`[DEBUG] 🌐 REST Fallback: "${text.substring(0, 30)}..."`);
            for await (const chunk of this.tts.generateStream(text)) {
                if (signal.aborted || this.shouldCancelPending) break;
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        event: 'media',
                        streamSid: this.streamSid,
                        media: { payload: chunk.toString('base64') }
                    }));
                }
            }
        } catch (err) {
            if ((err as any).name !== 'AbortError') console.error('[REST TTS ERR]', err);
        } finally {
            if (!signal.aborted && this.currentSpeechAbort?.signal === signal) this.currentSpeechAbort = null;
        }
    }

    private enqueueProcessing(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.processingChain = this.processingChain
            .then(() => this.handleLLMResponse(role, content, tool_use_id))
            .catch(err => console.error('[CRITICAL] Chain Error:', err));
    }

    private async handleInitialGreeting() {
        this.shouldCancelPending = false;
        if (!this.config) return;

        const greeting = "Just so you know, this call might be recorded. " +
            (this.config.aiSettings.greeting || "Hi! How can I help you today?");

        this.history.push({ role: 'assistant', content: greeting });
        this.logTurn('assistant', greeting);

        this.speakREST(greeting).catch(err => console.error('[GREETING ERR]', err));
        this.ensureTTSSession();
    }

    private async handleLLMResponse(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        if (role === 'user') {
            this.shouldCancelPending = false;
            this.ensureTTSSession();
        }

        this.history.push({ role, content, tool_use_id });
        this.pruneHistory();

        if (this.shouldCancelPending && role === 'user') return;
        if (role === 'user' && typeof content === 'string') this.logTurn('user', content);

        logger.latency(this.callSid, 'LLM_START', Date.now());

        try {
            if (config.features.enableStreamingLLM) {
                await this.handleStreamingResponse();
            } else {
                const response = await this.llm.generateResponse(this.history, {
                    businessName: this.config!.businessName,
                    timezone: this.config!.timezone
                });
                for (const block of response.content) {
                    if (this.shouldCancelPending) break;
                    if (block.type === 'text') {
                        this.logTurn('assistant', block.text);
                        await this.speak(block.text);
                    } else if (block.type === 'tool_use') {
                        await this.handleToolCall(block);
                    }
                }
            }
        } catch (err) {
            console.error('[HANDLER ERR]', err);
        } finally {
            if (role === 'user' || this.shouldCancelPending) {
                this.cleanupTTS();
            }
        }
    }

    private async handleStreamingResponse() {
        this.shouldCancelPending = false;
        this.currentAbortController = new AbortController();
        const session = this.ensureTTSSession();

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
                if (this.currentAbortController?.signal.aborted || this.shouldCancelPending) throw new Error('Turn Aborted');

                const usage = (chunk as any).usage || (chunk as any).message?.usage;
                if (usage) {
                    logger.economic(this.callSid, { tokens_input: usage.input_tokens, tokens_output: usage.output_tokens });
                }

                if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                    if (currentText) {
                        assistantContent.push({ type: 'text', text: currentText });
                        currentText = '';
                    }
                    currentTool = { id: chunk.content_block.id, name: chunk.content_block.name, input: '' };
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                    if (currentTool) currentTool.input += chunk.delta.partial_json;
                } else if (chunk.type === 'content_block_stop') {
                    if (currentTool) {
                        assistantContent.push({
                            type: 'tool_use',
                            id: currentTool.id,
                            name: currentTool.name,
                            input: JSON.parse(currentTool.input)
                        });
                        this.history.push({ role: 'assistant', content: assistantContent });
                        const input = JSON.parse(currentTool.input);
                        const result = await this.toolExecutor.execute(currentTool.name, input, this.clientId!);
                        this.logTurn('assistant', `[TOOL RESULT] ${currentTool.name}: ${result}`);
                        if (currentTool.name === 'book_appointment' && !result.includes('Error')) this.transitionTo(CallState.CONFIRMATION);
                        await this.handleLLMResponse('tool', result, currentTool.id);
                        currentTool = null;
                        return;
                    } else if (currentText) {
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
                    session.send(text);
                }
            }

            if (currentText) assistantContent.push({ type: 'text', text: currentText });
            if (assistantContent.length > 0) {
                this.history.push({ role: 'assistant', content: assistantContent });
                const fullText = assistantContent.filter(b => b.type === 'text').map(b => b.text).join(' ');
                if (fullText) this.logTurn('assistant', fullText);
            }
        } finally {
            this.currentAbortController = null;
        }
    }

    private async handleToolCall(block: any) {
        const result = await this.toolExecutor.execute(block.name, block.input, this.clientId!);
        this.logTurn('assistant', `[TOOL RESULT] ${block.name}: ${result}`);
        if (block.name === 'book_appointment' && !result.includes('Error')) this.transitionTo(CallState.CONFIRMATION);
        if (result === 'TRIGGER_VOICEMAIL_FALLBACK') {
            this.ws.close();
            return;
        }
        await this.handleLLMResponse('tool', result, block.id);
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
            const systemMsgs = this.history.filter(m => m.role === 'system');
            const dataMsgs = this.history.filter(m => {
                const text = typeof m.content === 'string' ? m.content.toLowerCase() : JSON.stringify(m.content).toLowerCase();
                return m.role !== 'system' && (text.includes('name') || text.includes('phone') || text.includes('email') || text.includes('@') || text.includes('captured'));
            });
            const otherMsgs = this.history.filter(m => m.role !== 'system' && !dataMsgs.includes(m)).slice(-this.KEEP_RECENT);
            this.history = [...systemMsgs, ...dataMsgs, ...otherMsgs];
        }
    }

    private finalizeCall(status: any) {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        if (!this.callSid) return;
        callLogRepository.update(this.callSid, { call_status: status, call_duration: 0 });
    }

    private async speak(text: string) {
        if (!text.trim()) return;
        this.isAISpeaking = true;
        try {
            const session = this.ensureTTSSession();
            if ((session as any).isOpen) {
                session.send(text);
                const estimatedDuration = (text.length / 15) * 1000;
                await new Promise(resolve => setTimeout(resolve, Math.min(2000, estimatedDuration)));
            } else {
                await this.speakREST(text);
            }
        } catch (error) {
            await this.speakREST(text);
        } finally {
            this.isAISpeaking = false;
        }
    }
}
