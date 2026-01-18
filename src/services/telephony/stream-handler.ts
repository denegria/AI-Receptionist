import WebSocket from 'ws';
import { DeepgramSTTService } from '../voice/stt';
import { DeepgramTTSService } from '../voice/tts';
import { LLMService, ChatMessage } from '../ai/llm';
import { ToolExecutor } from '../ai/tool-executor';
import { callLogRepository } from '../../db/repositories/call-log-repository';
import { conversationTurnRepository } from '../../db/repositories/conversation-turn-repository';
import { loadClientConfig, ClientConfig } from '../../models/client-config';

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

    constructor(ws: WebSocket, clientId?: string) {
        this.ws = ws;
        this.clientId = clientId || null;

        // Load config if clientId is provided (though query params might be missing)
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
    }

    private setupSocket() {
        this.ws.on('message', async (msg: string) => {
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.error("[DEBUG] Invalid JSON from Twilio:", msg.substring(0, 100));
                return;
            }

            if (data.event !== 'media') {
                console.log(`[DEBUG] Received Twilio Event: ${data.event}`);
            }

            switch (data.event) {
                case 'start':
                    console.log(`[DEBUG] Start Event Payload: ${JSON.stringify(data.start)}`);
                    this.streamSid = data.start.streamSid;
                    this.callSid = data.start.callSid || `sim-${Date.now()}`;
                    console.log(`[DEBUG] Stream initialized with Call SID: ${this.callSid}`);

                    if (data.start.customParameters?.clientId) {
                        this.clientId = data.start.customParameters.clientId;
                    }

                    if (!this.clientId) {
                        console.error('No Client ID provided in stream start');
                        this.clientId = 'abc'; // Final fallback for testing
                    }

                    // Load config now that we definitely have the ID
                    try {
                        this.config = loadClientConfig(this.clientId);
                    } catch (e) {
                        console.error(`Failed to load client config for ${this.clientId}:`, e);
                        this.ws.close();
                        return;
                    }

                    // Initialize Call Log
                    callLogRepository.create({
                        client_id: this.clientId,
                        call_sid: this.callSid,
                        caller_phone: 'unknown',
                        call_direction: 'inbound',
                        call_status: 'in-progress'
                    });

                    // Initial Greeting
                    await this.handleInitialGreeting();
                    break;

                case 'media':
                    if (data.media && data.media.payload) {
                        this.mediaPacketCount++;
                        const audio = Buffer.from(data.media.payload, 'base64');
                        if (this.mediaPacketCount % 100 === 0) {
                            console.log(`[DEBUG] Received 100 media packets (Total: ${this.mediaPacketCount}, Last Size: ${audio.length})`);
                        }
                        this.stt.send(audio);
                    }
                    break;

                case 'stop':
                    console.log('Twilio Media Stream Stopped');
                    this.stt.stop();
                    this.finalizeCall('completed');
                    break;
            }
        });

        this.ws.on('close', () => {
            this.stt.stop();
            this.finalizeCall('completed');
            console.log('Client disconnected from media stream');
        });
    }

    private setupSTT() {
        this.stt.start(async (transcript, isFinal, confidence) => {
            if (isFinal && transcript.trim().length > 0) {
                // User finished speaking - cancel any pending AI responses
                this.shouldCancelPending = true;

                // Feature: STT Confidence check
                if (confidence && confidence < 0.4) {
                    console.log(`STT [LOW CONFIDENCE: ${confidence}]: ${transcript}`);
                    await this.speak("I'm sorry, I didn't quite catch that. Could you please repeat it?");
                    return;
                }

                console.log(`STT [FINAL]: ${transcript} (Confidence: ${confidence})`);
                this.enqueueProcessing("user", transcript);
            } else if (transcript.trim().length > 0) {
                console.log(`STT [INTERIM]: ${transcript}`);
                // Barge-in on interim transcript (user started speaking) - but only if AI is talking
                if (this.isAISpeaking) {
                    this.shouldCancelPending = true; // Signal abortion of current processing loop
                    this.sendClearSignal();
                }
            }
        }, () => {
            // Speech Started (Barge-in) - backup signal
            console.log('[DEBUG] Barge-in detected via speech_started!');
            if (this.isAISpeaking) {
                this.shouldCancelPending = true;
                this.sendClearSignal();
            }
        });
    }

    private sendClearSignal() {
        const clearMessage = {
            event: 'clear',
            streamSid: this.streamSid
        };
        if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            console.log('[DEBUG] Sending CLEAR signal to stop AI speech');
            this.ws.send(JSON.stringify(clearMessage));
            this.isAISpeaking = false; // AI is no longer speaking after clear
        }
    }

    private async handleInitialGreeting() {
        if (!this.config) return;

        const greeting = this.config.aiSettings.greeting || "Hello! How can I help you today?";
        console.log('[DEBUG] Greeting caller:', greeting);

        // Claude requires the first message to be 'user'.
        // We simulate the start of the call as a user "Hello".
        this.history.push({ role: 'user', content: 'Hello' });
        this.history.push({ role: 'assistant', content: greeting });
        this.logTurn('assistant', greeting);

        // Speak it
        await this.speak(greeting);
    }

    private enqueueProcessing(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.processingChain = this.processingChain.then(() =>
            this.handleLLMResponse(role, content, tool_use_id)
        );
    }

    private async handleLLMResponse(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        // Check if this response was cancelled by user interruption
        if (this.shouldCancelPending && role !== 'user') {
            console.log('[DEBUG] Skipping cancelled pending response');
            return;
        }

        // Clear the cancel flag when processing new user input
        if (role === 'user') {
            this.shouldCancelPending = false;
        }

        this.history.push({ role, content, tool_use_id });

        // Feature: Memory Pruning (sliding window of last 10 messages to keep context window clean)
        if (this.history.length > 20) {
            // Keep first 2 (original system instructions) and last 10
            this.history = [
                this.history[0],
                this.history[1],
                ...this.history.slice(-10)
            ];
        }

        // Log user turns
        if (role === 'user' && typeof content === 'string') {
            this.logTurn('user', content);
        }

        try {
            console.log(`[DEBUG] Sending to LLM. History length: ${this.history.length}`);
            const response = await this.llm.generateResponse(this.history, {
                businessName: this.config!.businessName,
                timezone: this.config!.timezone
            });

            // Push the entire assistant response to history at once
            this.history.push({ role: 'assistant', content: response.content });

            for (const block of response.content) {
                // Stop processing if user interrupted during this response
                if (this.shouldCancelPending) {
                    console.log('[DEBUG] Interruption detected, aborting response blocks');
                    break;
                }

                if (block.type === 'text') {
                    console.log(`[DEBUG] AI Assistant Text: ${block.text}`);
                    this.logTurn('assistant', block.text);
                    await this.speak(block.text);
                } else if (block.type === 'tool_use') {
                    console.log(`[DEBUG] AI calling tool: ${block.name}`);
                    this.logTurn('assistant', `[TOOL CALL] ${block.name}: ${JSON.stringify(block.input)}`);
                    const result = await this.toolExecutor.execute(block.name, block.input, this.clientId!);
                    this.logTurn('assistant', `[TOOL RESULT] ${block.name}: ${result}`);

                    if (result === 'TRIGGER_VOICEMAIL_FALLBACK') {
                        console.log('Voicemail fallback triggered by AI.');
                        this.ws.close();
                        return;
                    }

                    // Handle the tool result by adding it to history and triggering next LLM turn
                    await this.handleLLMResponse('tool', result, block.id);
                }
            }
        } catch (error: any) {
            console.error('LLM Handling Error:', error);
            callLogRepository.update(this.callSid, { error_message: error.message });
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

    private finalizeCall(status: any) {
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
