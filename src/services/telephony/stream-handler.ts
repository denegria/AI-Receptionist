import WebSocket from 'ws';
import { DeepgramSTTService } from '../voice/stt';
import { DeepgramTTSService } from '../voice/tts';
import { LLMService, ChatMessage } from '../ai/llm';
import { ToolExecutor } from '../ai/tool-executor';
import { callLogRepository } from '../../db/repositories/call-log-repository';
import { conversationTurnRepository } from '../../db/repositories/conversation-turn-repository';

export class StreamHandler {
    private ws: WebSocket;
    private stt: DeepgramSTTService;
    private tts: DeepgramTTSService;
    private llm: LLMService;
    private toolExecutor: ToolExecutor;
    private history: ChatMessage[] = [];
    private clientId: string = 'client-abc';
    private callSid: string = '';
    private streamSid: string = '';
    private turnCount: number = 0;
    private processingChain: Promise<void> = Promise.resolve();

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.stt = new DeepgramSTTService();
        this.tts = new DeepgramTTSService();
        this.llm = new LLMService();
        this.toolExecutor = new ToolExecutor();

        this.setupSocket();
        this.setupSTT();
    }

    private setupSocket() {
        this.ws.on('message', (msg: string) => {
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.error("Invalid JSON from Twilio:", msg);
                return;
            }

            switch (data.event) {
                case 'start':
                    console.log('Twilio Media Stream Started:', data.start.streamSid);
                    this.streamSid = data.start.streamSid;
                    this.callSid = data.start.callSid || `sim-${Date.now()}`;

                    if (data.start.customParameters?.clientId) {
                        this.clientId = data.start.customParameters.clientId;
                    }

                    // Initialize Call Log
                    callLogRepository.create({
                        client_id: this.clientId,
                        call_sid: this.callSid,
                        caller_phone: 'unknown', // Ideally extracted from 'From' in webhook
                        call_direction: 'inbound',
                        call_status: 'in-progress'
                    });

                    // Initial Greeting
                    this.enqueueProcessing("system", "Greeting the caller. Start the conversation.");
                    break;

                case 'media':
                    if (data.media && data.media.payload) {
                        const audio = Buffer.from(data.media.payload, 'base64');
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
        this.stt.start(async (transcript, isFinal) => {
            if (isFinal && transcript.trim().length > 0) {
                console.log(`STT [FINAL]: ${transcript}`);
                this.enqueueProcessing("user", transcript);
            }
        });
    }

    private enqueueProcessing(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.processingChain = this.processingChain.then(() =>
            this.handleLLMResponse(role, content, tool_use_id)
        );
    }

    private async handleLLMResponse(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.history.push({ role, content, tool_use_id });

        // Log user turns
        if (role === 'user' && typeof content === 'string') {
            this.logTurn('user', content);
        }

        try {
            const response = await this.llm.generateResponse(this.history);

            for (const block of response.content) {
                if (block.type === 'text') {
                    console.log('Assistant:', block.text);
                    this.history.push({ role: 'assistant', content: block.text });
                    this.logTurn('assistant', block.text);
                    await this.speak(block.text);
                } else if (block.type === 'tool_use') {
                    const result = await this.toolExecutor.execute(block.name, block.input, this.clientId);

                    if (result === 'TRIGGER_VOICEMAIL_FALLBACK') {
                        console.log('Voicemail fallback triggered by AI.');
                        // Say goodbye before closing? The TwiML fallback has its own <Say>
                        // but we can speak one last time here if desired.
                        this.ws.close();
                        return;
                    }

                    this.history.push({ role: 'assistant', content: block });
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
                this.ws.send(JSON.stringify(message));
            }
        } catch (error) {
            console.error('TTS Error:', error);
        }
    }
}
