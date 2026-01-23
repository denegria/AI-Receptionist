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
    private currentAbortController: AbortController | null = null;
    private currentSpeechAbort: AbortController | null = null;
    private currentTTSLive: { send: (t: string) => void, finish: () => void } | null = null;
    private turnStartTime: number = 0;
    private dbReady: Promise<void> = Promise.resolve();
    private turnBuffer: any[] = [];

    private readonly INACTIVITY_LIMIT_MS = 30000;
    private readonly MAX_HISTORY = 20;
    private readonly KEEP_RECENT = 10;

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
                console.error("[DEBUG] Invalid JSON from Twilio");
                return;
            }

            if (data.event === 'start') {
                this.streamSid = data.start.streamSid;
                this.callSid = data.start.callSid || `sim-${Date.now()}`;
                this.stateManager = new CallStateManager(this.callSid);
                console.log(`[DEBUG] 🚀 Stream started for ${this.callSid}`);

                // 1. Resolve Identity & Config
                if (data.start.customParameters?.callerPhone) this.callerPhone = data.start.customParameters.callerPhone;
                if (data.start.customParameters?.clientId) this.clientId = data.start.customParameters.clientId;
                if (!this.clientId) this.clientId = 'abc';

                try {
                    this.config = loadClientConfig(this.clientId);
                    // 2. Init DB in background, but tracked
                    this.dbReady = (async () => {
                        await callLogRepository.create({
                            client_id: this.clientId!,
                            call_sid: this.callSid,
                            caller_phone: this.callerPhone,
                            call_direction: 'inbound',
                            call_status: 'initiated'
                        });
                        // Flush any turns that happened during boot
                        for (const turn of this.turnBuffer) {
                            await conversationTurnRepository.create(turn);
                        }
                        this.turnBuffer = [];
                    })();
                } catch (e) {
                    console.error('[CRITICAL] Failed to init call record:', e);
                }

                // 3. TRIGGER GREETING (Now safe to log turn)
                this.transitionTo(CallState.GREETING);
                this.handleInitialGreeting().catch(err => console.error('[GREETING ERROR]', err));
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
                    await this.speak("I'm sorry, I didn't quite catch that. Could you say it again?");
                    return;
                }

                this.turnStartTime = Date.now();
                logger.latency(this.callSid, 'STT_FINAL', 0, { transcript, confidence });
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                // Barge-in detection
                if (this.isAISpeaking || this.currentAbortController) {
                    if (transcript.trim().split(' ').length > 3 || (confidence && confidence > 0.8)) {
                        this.shouldCancelPending = true;
                        this.sendClearSignal();
                    }
                }
            }
        }, () => {
            if (this.isAISpeaking || this.currentAbortController) {
                this.shouldCancelPending = true;
                this.sendClearSignal();
            }
        });
    }

    private resetInactivityTimer() {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(async () => {
            if (this.stateManager.getState() !== CallState.TERMINATED) {
                await this.speak("I haven't heard from you in a while, so I'll go ahead and end the call. Goodbye!");
                setTimeout(() => this.ws.close(), 5000);
            }
        }, this.INACTIVITY_LIMIT_MS);
    }

    private sendClearSignal() {
        if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            this.ws.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
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
        console.log('[DEBUG] 🚀 Opening Interaction-level TTS Session...');
        const session = this.tts.createLiveSession((chunk) => {
            if (this.shouldCancelPending) return;
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
            }
        });
        this.currentTTSLive = session;
        return session;
    }

    private cleanupTTS() {
        if (this.currentTTSLive) {
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
            for await (const chunk of this.tts.generateStream(text)) {
                if (signal.aborted || this.shouldCancelPending) break;
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ event: 'media', streamSid: this.streamSid, media: { payload: chunk.toString('base64') } }));
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
            .then(() => this.processInteraction(role, content, tool_use_id))
            .catch(err => console.error('[CRITICAL] Interaction Error:', err));
    }

    private async handleInitialGreeting() {
        this.shouldCancelPending = false;
        const greeting = "Just so you know, this call might be recorded. " +
            (this.config?.aiSettings.greeting || "Hi! How can I help you today?");
        this.history.push({ role: 'assistant', content: greeting });
        this.logTurn('assistant', greeting);
        this.speakREST(greeting).catch(() => { });
        this.ensureTTSSession();
    }

    private async processInteraction(initialRole: 'user' | 'system' | 'tool', initialContent: any, initialToolId?: string) {
        let currentRole = initialRole;
        let currentContent = initialContent;
        let currentToolId = initialToolId;

        if (currentRole === 'user') {
            this.ensureTTSSession();
        }

        while (true) {
            // CRITICAL: Reset cancellation for each sub-turn of the interaction
            this.shouldCancelPending = false;

            if (this.ws.readyState !== WebSocket.OPEN) break;

            this.history.push({ role: currentRole, content: currentContent, tool_use_id: currentToolId });
            this.pruneHistory();

            // NON-BLOCKING logging
            if (currentRole === 'user' && typeof currentContent === 'string') {
                this.logTurn('user', currentContent);
            }

            logger.latency(this.callSid, 'LLM_START', Date.now());
            const result = await this.runLLMTurn();

            if (result.type === 'final') {
                break;
            } else {
                currentRole = 'tool';
                currentContent = result.toolResult;
                currentToolId = result.toolId;
            }
        }

        if (initialRole === 'user' || this.shouldCancelPending) this.cleanupTTS();
    }

    private async runLLMTurn(): Promise<{ type: 'final' } | { type: 'tool', toolResult: any, toolId: string }> {
        this.currentAbortController = new AbortController();
        const session = this.ensureTTSSession();
        const stream = this.llm.generateStream(this.history, {
            businessName: this.config?.businessName || 'the business',
            timezone: this.config?.timezone || 'UTC'
        });

        let assistantContent: any[] = [];
        let currentText = '';
        let currentTool: any = null;
        let isFirstToken = true;

        try {
            for await (const chunk of stream) {
                if (this.shouldCancelPending || this.currentAbortController.signal.aborted) throw new Error('Aborted');

                const usage = (chunk as any).usage || (chunk as any).message?.usage;
                if (usage) logger.economic(this.callSid, { tokens_input: usage.input_tokens, tokens_output: usage.output_tokens });

                if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
                    if (currentText) { assistantContent.push({ type: 'text', text: currentText }); currentText = ''; }
                    currentTool = { id: chunk.content_block.id, name: chunk.content_block.name, input: '' };
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
                    if (currentTool) currentTool.input += chunk.delta.partial_json;
                } else if (chunk.type === 'content_block_stop') {
                    if (currentTool) {
                        const input = JSON.parse(currentTool.input);
                        assistantContent.push({ type: 'tool_use', id: currentTool.id, name: currentTool.name, input });
                        this.history.push({ role: 'assistant', content: assistantContent });
                        const toolResult = await this.toolExecutor.execute(currentTool.name, input, this.clientId!);
                        this.logTurn('assistant', `[TOOL RESULT] ${currentTool.name}: ${toolResult}`);
                        if (currentTool.name === 'book_appointment' && !toolResult.includes('Error')) this.transitionTo(CallState.CONFIRMATION);
                        return { type: 'tool', toolResult, toolId: currentTool.id };
                    } else if (currentText) {
                        assistantContent.push({ type: 'text', text: currentText });
                        currentText = '';
                    }
                } else if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    const text = chunk.delta.text;
                    if (isFirstToken && text.trim()) {
                        console.log(`[DEBUG] 🎙️ First AI Text Token: "${text}"`);
                        isFirstToken = false;
                    }
                    currentText += text;
                    session.send(text);
                }
            }

            if (currentText) assistantContent.push({ type: 'text', text: currentText });
            if (assistantContent.length > 0) {
                this.history.push({ role: 'assistant', content: assistantContent });
                const fullText = assistantContent.filter(b => b.type === 'text').map(b => b.text).join(' ');
                if (fullText) {
                    console.log(`[DEBUG] 🤖 AI Response: "${fullText}"`);
                    this.logTurn('assistant', fullText);
                }
            }
            return { type: 'final' };
        } catch (err) {
            console.error('[TURN ERR]', err);
            return { type: 'final' };
        } finally {
            this.currentAbortController = null;
        }
    }

    private logTurn(role: 'user' | 'assistant', content: string) {
        this.turnCount++;
        const turn = {
            call_sid: this.callSid,
            turn_number: this.turnCount,
            role,
            content: content.substring(0, 4000) // Safety
        };

        // Fire and forget - do not await in the main loop
        (async () => {
            try {
                await this.dbReady;
                await conversationTurnRepository.create(turn);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.warn('[DB] Buffering turn due to delay/error:', msg);
                this.turnBuffer.push(turn);
            }
        })();
    }

    private pruneHistory() {
        if (this.history.length > this.MAX_HISTORY) {
            const sys = this.history.filter(m => m.role === 'system');
            const data = this.history.filter(m => {
                const t = typeof m.content === 'string' ? m.content.toLowerCase() : JSON.stringify(m.content).toLowerCase();
                return m.role !== 'system' && (t.includes('name') || t.includes('phone') || t.includes('email') || t.includes('@') || t.includes('captured'));
            });
            const other = this.history.filter(m => m.role !== 'system' && !data.includes(m)).slice(-this.KEEP_RECENT);
            this.history = [...sys, ...data, ...other];
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
                await new Promise(r => setTimeout(r, Math.min(2000, (text.length / 15) * 1000)));
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
