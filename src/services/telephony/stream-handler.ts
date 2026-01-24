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
    private callDurationTimeout?: NodeJS.Timeout;
    private stateManager: CallStateManager;
    private callerPhone: string = 'unknown';
    private currentSpeechAbort: AbortController | null = null;
    private dbReady: Promise<void> = Promise.resolve();
    private turnBuffer: any[] = [];
    private sentenceBuffer: string = '';
    private speechQueue: string[] = [];
    private isProcessingQueue: boolean = false;

    private readonly SENTENCE_END_REGEX = /[.!?](\s|$)/;
    private readonly ABBREVIATION_REGEX = /\b(Dr|Mr|Mrs|Ms|St|Ave|Inc|Jr|Sr|Prof|gov|com|net|org|edu)\.$/i;
    private readonly INACTIVITY_LIMIT_MS = 30000;
    private readonly MAX_HISTORY = 20;

    constructor(ws: WebSocket, clientId?: string) {
        this.ws = ws;
        this.clientId = clientId || null;
        this.stateManager = new CallStateManager('pending');
        this.stt = new DeepgramSTTService();
        this.tts = new DeepgramTTSService();
        this.llm = new LLMService();
        this.toolExecutor = new ToolExecutor();

        this.setupSocket();
        this.setupSTT();

        // Hard duration limit
        this.callDurationTimeout = setTimeout(async () => {
            console.log('⏰ MAX DURATION REACHED - Force terminating call');
            this.enqueueSpeech("I'm sorry, I have to end the call now as we've reached the system time limit. Goodbye.");
            setTimeout(() => this.ws.close(), 3000);
        }, config.voice.maxDurationMs);
    }

    private setupSocket() {
        this.ws.on('message', async (msg: string) => {
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.error("[DEBUG] Invalid JSON from Twilio");
                return;
            }

            if (data.event === 'start') {
                this.streamSid = data.start.streamSid;
                this.callSid = data.start.callSid || `sim-${Date.now()}`;
                this.stateManager = new CallStateManager(this.callSid);
                console.log(`[DEBUG] 🚀 Stream started for ${this.callSid}`);

                // 1. GREETING FIRST (Zero delay)
                this.transitionTo(CallState.GREETING);
                this.handleInitialGreeting().catch(err => console.error('[GREETING ERROR]', err));

                if (data.start.customParameters?.callerPhone) this.callerPhone = data.start.customParameters.callerPhone;
                if (data.start.customParameters?.clientId) this.clientId = data.start.customParameters.clientId;
                if (!this.clientId) this.clientId = 'abc';

                try {
                    this.config = loadClientConfig(this.clientId);
                    // 2. Init DB in background
                    this.dbReady = (async () => {
                        await callLogRepository.create({
                            client_id: this.clientId!,
                            call_sid: this.callSid,
                            caller_phone: this.callerPhone,
                            call_direction: 'inbound',
                            call_status: 'initiated'
                        });
                        for (const turn of this.turnBuffer) {
                            await conversationTurnRepository.create({ ...turn, client_id: this.clientId! });
                        }
                        this.turnBuffer = [];
                    })();
                } catch (e) {
                    console.error('Failed to resolve config:', e);
                }
            } else if (data.event === 'media') {
                if (data.media?.payload) {
                    this.mediaPacketCount++;
                    this.stt.send(Buffer.from(data.media.payload, 'base64'));
                }
            } else if (data.event === 'stop') {
                this.finalizeCall('completed');
                this.transitionTo(CallState.TERMINATED);
            }
        });

        this.ws.on('close', () => {
            this.stt.stop();
            if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
            if (this.callDurationTimeout) clearTimeout(this.callDurationTimeout);
            this.finalizeCall('completed');
        });
    }

    private transitionTo(newState: CallState) {
        this.stateManager.transitionTo(newState);
    }

    private setupSTT() {
        this.stt.start(async (transcript, isFinal, confidence) => {
            if (isFinal && transcript.trim().length > 0) {
                console.log(`STT [FINAL]: ${transcript} (Confidence: ${confidence})`);
                this.shouldCancelPending = true;
                this.resetInactivityTimer();
                this.transitionTo(CallState.CONVERSATION);

                if (confidence && confidence < config.voice.asrConfidenceThreshold) {
                    this.enqueueSpeech("I'm sorry, I didn't quite catch that. Could you say it again?");
                    return;
                }

                logger.latency(this.callSid, 'STT_FINAL', 0, { transcript, confidence });
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                if (this.isAISpeaking) {
                    if (transcript.trim().split(' ').length > 2 || (confidence && confidence > 0.8)) {
                        this.interruptAI();
                    }
                }
            }
        }, () => {
            if (this.isAISpeaking) this.interruptAI();
        });
    }

    private interruptAI() {
        console.log('[DEBUG] 🛑 Interrupting AI Speech');
        this.shouldCancelPending = true;
        this.speechQueue = [];
        this.sentenceBuffer = '';
        if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        }
        if (this.currentSpeechAbort) {
            this.currentSpeechAbort.abort();
            this.currentSpeechAbort = null;
        }
        this.isAISpeaking = false;
    }

    private resetInactivityTimer() {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(async () => {
            if (this.stateManager.getState() !== CallState.TERMINATED) {
                this.enqueueSpeech("I haven't heard from you in a while, so I'll go ahead and end the call. Goodbye!");
                setTimeout(() => this.ws.close(), 5000);
            }
        }, this.INACTIVITY_LIMIT_MS);
    }

    private async speak(text: string) {
        if (!text.trim()) return;

        if (this.currentSpeechAbort) this.currentSpeechAbort.abort();
        this.currentSpeechAbort = new AbortController();
        const signal = this.currentSpeechAbort.signal;

        this.isAISpeaking = true;
        try {
            console.log(`[DEBUG] 🎙️ Speaking: "${text.substring(0, 30)}..."`);
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
            // Hold floor briefly to allow audio delivery
            if (!signal.aborted && !this.shouldCancelPending) {
                const duration = Math.min(2500, (text.length / 15) * 1000);
                await new Promise(r => setTimeout(r, duration));
            }
        } catch (err) {
            if ((err as any).name !== 'AbortError') console.error('[SPEECH ERR]', err);
        } finally {
            if (!signal.aborted && this.currentSpeechAbort?.signal === signal) {
                this.currentSpeechAbort = null;
                this.isAISpeaking = false;
            }
        }
    }

    private enqueueSpeech(text: string) {
        if (!text.trim()) return;
        this.speechQueue.push(text);
        this.processSpeechQueue().catch(err => console.error('[CRITICAL] Queue Error:', err));
    }

    private async processSpeechQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.speechQueue.length > 0) {
            if (this.shouldCancelPending) {
                this.speechQueue = [];
                break;
            }
            const text = this.speechQueue.shift();
            if (text) await this.speak(text);
        }

        this.isProcessingQueue = false;
    }

    private enqueueProcessing(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.processingChain = this.processingChain
            .then(() => this.processInteraction(role, content, tool_use_id))
            .catch(err => console.error('[CRITICAL] Interaction Error:', err));
    }

    private async handleInitialGreeting() {
        this.shouldCancelPending = false;
        const greeting = "Just so you know, this call might be recorded. " +
            (this.config?.aiSettings.greeting || "Hi! How can I help you today?");
        this.history.push({ role: 'assistant', content: greeting });
        this.logTurn('assistant', greeting);
        this.enqueueSpeech(greeting);
    }

    private async processInteraction(role: 'user' | 'system' | 'tool', content: any, toolId?: string) {
        let currentRole = role;
        let currentContent = content;
        let currentToolId = toolId;

        if (currentRole === 'user') this.shouldCancelPending = false;

        while (true) {
            if (this.shouldCancelPending || this.ws.readyState !== WebSocket.OPEN) break;

            this.history.push({ role: currentRole, content: currentContent, tool_use_id: currentToolId });
            this.pruneHistory();
            if (currentRole === 'user' && typeof currentContent === 'string') this.logTurn('user', currentContent);

            const result = await this.runLLMTurn();

            if (result.type === 'final') {
                break;
            } else {
                currentRole = 'tool';
                currentContent = result.toolResult;
                currentToolId = result.toolId;
            }
        }
    }

    private async runLLMTurn(): Promise<{ type: 'final' } | { type: 'tool', toolResult: any, toolId: string }> {
        const stream = this.llm.generateStream(this.history, {
            businessName: this.config?.businessName || 'the business',
            timezone: this.config?.timezone || 'UTC'
        });

        let assistantContent: any[] = [];
        let currentFullText = '';
        this.sentenceBuffer = '';
        let currentTool: { id: string, name: string, input: string } | null = null;

        try {
            for await (const chunk of stream) {
                if (this.shouldCancelPending) throw new Error('Aborted');

                const usage = (chunk as any).usage || (chunk as any).message?.usage;
                if (usage) logger.economic(this.callSid, { tokens_input: usage.input_tokens, tokens_output: usage.output_tokens });

                if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                    // Start technical turn
                    currentTool = { id: chunk.content_block.id, name: chunk.content_block.name, input: '' };
                    if (this.sentenceBuffer.trim()) {
                        this.enqueueSpeech(this.sentenceBuffer.trim());
                        this.sentenceBuffer = '';
                    }
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                    if (currentTool) currentTool.input += chunk.delta.partial_json;
                } else if (chunk.type === 'content_block_stop') {
                    if (currentTool) {
                        const input = JSON.parse(currentTool.input);
                        if (currentFullText) assistantContent.push({ type: 'text', text: currentFullText });
                        assistantContent.push({ type: 'tool_use', id: currentTool.id, name: currentTool.name, input });
                        this.history.push({ role: 'assistant', content: assistantContent });

                        const toolResult = await this.toolExecutor.execute(currentTool.name, input, this.clientId!);
                        this.logTurn('assistant', `[TOOL RESULT] ${currentTool.name}: ${toolResult}`);

                        if (currentTool.name === 'book_appointment' && !toolResult.includes('Error')) {
                            this.transitionTo(CallState.CONFIRMATION);
                        }

                        return { type: 'tool', toolResult, toolId: currentTool.id };
                    }
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    const text = chunk.delta.text;
                    currentFullText += text;
                    this.sentenceBuffer += text;

                    // Improved buffering: Split at the LAST valid sentence boundary
                    // This prevents "Okay. I" from being spoken as one chunk (leaving "I" stranded)
                    let boundaryIndex = -1;
                    const globalRegex = new RegExp(this.SENTENCE_END_REGEX, 'g');
                    let match;

                    while ((match = globalRegex.exec(this.sentenceBuffer)) !== null) {
                        const potentialEnd = match.index + match[0].length;
                        const candidate = this.sentenceBuffer.substring(0, potentialEnd).trim();
                        // Only accept boundary if it's NOT an abbreviation
                        if (!this.ABBREVIATION_REGEX.test(candidate)) {
                            boundaryIndex = potentialEnd;
                        }
                    }

                    if (boundaryIndex !== -1) {
                        const completePart = this.sentenceBuffer.substring(0, boundaryIndex);
                        this.enqueueSpeech(completePart.trim());
                        this.sentenceBuffer = this.sentenceBuffer.substring(boundaryIndex);
                    }
                }
            }

            // Flush remaining buffer at the end of the turn
            if (this.sentenceBuffer.trim()) this.enqueueSpeech(this.sentenceBuffer.trim());
            if (currentFullText) {
                assistantContent.push({ type: 'text', text: currentFullText });
                this.history.push({ role: 'assistant', content: assistantContent });
                this.logTurn('assistant', currentFullText);
                console.log(`[DEBUG] 🤖 AI Final Response: "${currentFullText}"`);
            }
            return { type: 'final' };
        } catch (err) {
            console.error('[TURN ERROR]', err);
            return { type: 'final' };
        }
    }

    private logTurn(role: 'user' | 'assistant', content: string) {
        this.turnCount++;
        const turn = { call_sid: this.callSid, turn_number: this.turnCount, role, content: content.substring(0, 4000), client_id: this.clientId! };
        (async () => {
            try {
                await this.dbReady;
                await conversationTurnRepository.create(turn);
            } catch (err) {
                this.turnBuffer.push(turn);
            }
        })();
    }

    private pruneHistory() {
        if (this.history.length > this.MAX_HISTORY) {
            const sys = this.history.filter(m => m.role === 'system');
            const other = this.history.slice(-10).filter(m => m.role !== 'system');
            this.history = [...sys, ...other];
        }
    }

    private finalizeCall(status: any) {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        if (!this.callSid) return;
        callLogRepository.update(this.callSid, { call_status: status });
    }
}
