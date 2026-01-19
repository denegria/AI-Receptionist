import WebSocket from 'ws';
import { DeepgramSTTService } from '../voice/stt';
import { DeepgramTTSService } from '../voice/tts';
import { LLMService, ChatMessage } from '../ai/llm';
import { ToolExecutor } from '../ai/tool-executor';
import { callLogRepository } from '../../db/repositories/call-log-repository';
import { conversationTurnRepository } from '../../db/repositories/conversation-turn-repository';
import { loadClientConfig, ClientConfig } from '../../models/client-config';
import { fallbackService, FallbackLevel } from './fallback-service';
import { logger } from '../logging';

// State Machine for Call Flow
enum CallState {
    INIT = 'INIT',
    GREETING = 'GREETING',
    INTENT_DETECTION = 'INTENT_DETECTION',
    INFO_CAPTURE = 'INFO_CAPTURE',
    CONFIRMATION = 'CONFIRMATION',
    HANDOFF = 'HANDOFF',
    TERMINATED = 'TERMINATED'
}

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
    private currentState: CallState = CallState.INIT; // State tracking
    private callerPhone: string = 'unknown';

    private readonly INACTIVITY_LIMIT_MS = 30000; // 30 seconds
    private readonly MAX_CALL_DURATION_MS = 600000; // 10 minutes
    private readonly MAX_HISTORY = 20;
    private readonly KEEP_RECENT = 10;
    private readonly ASR_CONFIDENCE_THRESHOLD = 0.6; // Stricter threshold

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
        }, this.MAX_CALL_DURATION_MS);
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
                } catch (e) {
                    this.ws.close();
                    return;
                }

                // Initial Greeting (State Transition)
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
        logger.info(`State Transition: ${this.currentState} -> ${newState}`, { callSid: this.callSid, from: this.currentState, to: newState });
        this.currentState = newState;
    }

    private setupSTT() {
        this.stt.start(async (transcript, isFinal, confidence) => {
            if (isFinal && transcript.trim().length > 0) {
                this.shouldCancelPending = true;

                // Feature: Strict Confidence Gate
                if (confidence && confidence < this.ASR_CONFIDENCE_THRESHOLD) {
                    logger.warn(`STT Low Confidence`, { callSid: this.callSid, transcript, confidence });
                    // Minimal fallback prompt
                    await this.speak("I'm sorry, the connection is a bit breaking up. Could you say that again?");
                    return;
                }

                console.log(`STT [FINAL]: ${transcript} (Confidence: ${confidence})`);
                this.resetInactivityTimer();
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                if (this.isAISpeaking) {
                    this.shouldCancelPending = true;
                    this.sendClearSignal();
                }
            }
        }, () => {
            if (this.isAISpeaking) {
                this.shouldCancelPending = true;
                this.sendClearSignal();
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

        // Feature: Compliance Message
        const complianceMsg = "This call may be recorded for quality purposes. ";
        const greeting = complianceMsg + (this.config.aiSettings.greeting || "Hello! How can I help you today?");

        this.history.push({ role: 'user', content: 'Hello' });
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

        // Feature: LLM Retry Logic
        let retryCount = 0;
        const maxRetries = 1;

        while (retryCount <= maxRetries) {
            try {
                console.log(`[DEBUG] Sending to LLM. History length: ${this.history.length}. Attempt: ${retryCount + 1}`);
                const response = await this.llm.generateResponse(this.history, {
                    businessName: this.config!.businessName,
                    timezone: this.config!.timezone
                });

                // ... (processing response blocks logic remains identical to existing implementation)
                const assistantMessage = { role: 'assistant' as const, content: response.content };
                this.history.push(assistantMessage);

                for (const block of response.content) {
                    if (this.shouldCancelPending) {
                        assistantMessage.content = assistantMessage.content.filter((b: any) => {
                            if (b.type === 'text') return true;
                            return false;
                        });
                        break;
                    }

                    if (block.type === 'text') {
                        this.logTurn('assistant', block.text);
                        await this.speak(block.text);
                    } else if (block.type === 'tool_use') {
                        this.logTurn('assistant', `[TOOL CALL] ${block.name}`);
                        const result = await this.toolExecutor.execute(block.name, block.input, this.clientId!);
                        this.logTurn('assistant', `[TOOL RESULT] ${block.name}: ${result}`);

                        // Check for successful booking to update state
                        if (block.name === 'book_appointment' && !result.includes('Error')) {
                            this.transitionTo(CallState.CONFIRMATION);
                        }

                        if (result === 'TRIGGER_VOICEMAIL_FALLBACK') {
                            this.ws.close();
                            return;
                        }
                        await this.handleLLMResponse('tool', result, block.id);
                    }
                }
                break; // Break retry loop on success

            } catch (error: any) {
                console.error(`LLM Error (Attempt ${retryCount + 1}):`, error);
                retryCount++;
                if (retryCount > maxRetries) {
                    console.error('Max LLM retries exceeded. Triggering Fallback.');
                    const fallbackResponse = await fallbackService.handleFallback(
                        FallbackLevel.LEVEL_2_HARD,
                        this.callSid,
                        this.callerPhone,
                        error.message
                    );
                    await this.speak(fallbackResponse);
                    this.ws.close();
                }
            }
        }
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
            const audioBuffer = await this.tts.generate(text);
            const payload = audioBuffer.toString('base64');

            const message = {
                event: 'media',
                streamSid: this.streamSid,
                media: {
                    payload: payload
                }
            };

            if (this.ws.readyState === WebSocket.OPEN) {
                console.log(`[DEBUG] Sending ${payload.length} bytes of audio to Twilio`);
                this.ws.send(JSON.stringify(message));
                // Keep isAISpeaking true - it will be cleared when user interrupts or after a delay
                // Set a timeout to clear the flag after the audio should be done playing
                const estimatedDuration = (audioBuffer.length / 8000) * 1000; // rough estimate
                setTimeout(() => {
                    this.isAISpeaking = false;
                }, estimatedDuration);
            } else {
                console.warn('[DEBUG] WebSocket not open, could not send audio');
                this.isAISpeaking = false;
            }
        } catch (error) {
            console.error('TTS Error:', error);
            this.isAISpeaking = false;
        }
    }
}
