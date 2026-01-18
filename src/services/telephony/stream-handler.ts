import WebSocket from 'ws';
import { DeepgramSTTService } from '../voice/stt';
import { DeepgramTTSService } from '../voice/tts';
import { LLMService, ChatMessage } from '../ai/llm';
import { ToolExecutor } from '../ai/tool-executor';

export class StreamHandler {
    private ws: WebSocket;
    private stt: DeepgramSTTService;
    private tts: DeepgramTTSService;
    private llm: LLMService;
    private toolExecutor: ToolExecutor;
    private streamSid: string = '';
    private history: ChatMessage[] = [];
    private clientId: string = 'client-abc'; // Default for MVP testing

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
                    // Extract clientId if present in custom params
                    if (data.start.customParameters?.clientId) {
                        this.clientId = data.start.customParameters.clientId;
                    }
                    // Initial Greeting
                    this.handleLLMResponse("system", "Greeting the caller. Start the conversation.");
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
                    break;
            }
        });

        this.ws.on('close', () => {
            this.stt.stop();
            console.log('Client disconnected from media stream');
        });
    }

    private setupSTT() {
        this.stt.start(async (transcript, isFinal) => {
            if (isFinal && transcript.trim().length > 0) {
                console.log(`STT [FINAL]: ${transcript}`);
                await this.handleLLMResponse("user", transcript);
            }
        });
    }

    private async handleLLMResponse(role: 'user' | 'system' | 'tool', content: any, tool_use_id?: string) {
        this.history.push({ role, content, tool_use_id });

        try {
            const response = await this.llm.generateResponse(this.history);

            // Handle multiple content blocks (text or tool_use)
            for (const block of response.content) {
                if (block.type === 'text') {
                    console.log('Assistant:', block.text);
                    this.history.push({ role: 'assistant', content: block.text });
                    await this.speak(block.text);
                } else if (block.type === 'tool_use') {
                    const result = await this.toolExecutor.execute(block.name, block.input, this.clientId);
                    // Add tool call and result to history and re-trigger LLM
                    this.history.push({ role: 'assistant', content: block }); // Push the actual tool_use block
                    await this.handleLLMResponse('tool', result, block.id);
                }
            }
        } catch (error) {
            console.error('LLM Handling Error:', error);
        }
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
