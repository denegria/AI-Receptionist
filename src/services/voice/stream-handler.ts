import WebSocket from 'ws';
import { DeepgramSTTService } from './deepgram-stt';
import { DeepgramTTSService } from './deepgram-tts';
import { LLMService } from '../ai/llm';
import { IntentDetector } from '../ai/intent-detector';

export class StreamHandler {
    private ws: WebSocket;
    private stt: DeepgramSTTService;
    private tts: DeepgramTTSService;
    private llm: LLMService;
    private streamSid: string = '';

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.stt = new DeepgramSTTService();
        this.tts = new DeepgramTTSService();
        this.llm = new LLMService();

        this.setupSocket();
        this.setupSTT();
    }

    private setupSocket() {
        this.ws.on('message', (msg: string) => {
            const data = JSON.parse(msg);

            switch (data.event) {
                case 'start':
                    console.log('Twilio Media Stream Started:', data.start.streamSid);
                    this.streamSid = data.start.streamSid;
                    // Initial Greeting
                    this.speak("Hello! I am your AI receptionist. How can I help you today?");
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
            console.log(`STT [${isFinal ? 'FINAL' : 'PARTIAL'}]: ${transcript}`);

            if (isFinal && transcript.trim().length > 0) {
                // Determine response
                const responseText = await this.llm.generateResponse([{ role: 'user', content: transcript }]);
                console.log('LLM Response:', responseText);

                if (responseText) {
                    await this.speak(responseText);
                }
            }
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
