import { createClient } from '@deepgram/sdk';
import { config } from '../../config';

export class DeepgramSTTService {
    private deepgram: ReturnType<typeof createClient>;
    private connection: any = null;
    private isConnected = false;

    constructor() {
        this.deepgram = createClient(config.deepgram.apiKey);
    }

    /**
     * Starts a live transcription stream
     * @param onTranscript Callback when a transcript part is received
     */
    public start(onTranscript: (text: string, isFinal: boolean) => void): void {
        if (this.isConnected) return;

        this.connection = this.deepgram.listen.live({
            model: 'nova-2',
            language: 'en-US',
            smart_format: true,
            encoding: 'mulaw',
            sample_rate: 8000,
            channels: 1,
            interim_results: true,
            endpointing: 300,
            utterance_end_ms: 1000
        });

        this.connection.on('open', () => {
            this.isConnected = true;
            console.log('Deepgram STT Connected');
        });

        this.connection.on('transcript', (data: any) => {
            const alt = data.channel?.alternatives?.[0];
            if (alt && alt.transcript) {
                onTranscript(alt.transcript, data.is_final);
            }
        });

        this.connection.on('close', () => {
            this.isConnected = false;
            console.log('Deepgram STT Disconnected');
        });

        this.connection.on('error', (err: any) => {
            console.error('Deepgram STT Error:', err);
        });
    }

    /**
     * Sends audio buffer to Deepgram
     */
    public send(audio: Buffer): void {
        if (this.connection && this.isConnected) {
            this.connection.send(audio);
        }
    }

    /**
     * Closes the connection
     */
    public stop(): void {
        if (this.connection) {
            // Check if finish exists, otherwise destroy or just nullify
            if (typeof this.connection.finish === 'function') {
                this.connection.finish();
            }
            this.connection = null;
            this.isConnected = false;
        }
    }
}
