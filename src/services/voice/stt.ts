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
    public start(
        onTranscript: (text: string, isFinal: boolean, confidence?: number) => void,
        onSpeechStarted?: () => void
    ): void {
        if (this.isConnected) return;

        this.connection = this.deepgram.listen.live({
            model: config.deepgram.sttModel,
            language: 'en-US',
            smart_format: true,
            encoding: 'mulaw',
            sample_rate: 8000,
            channels: 1,
            interim_results: true,
            utterance_end_ms: 1000
        });

        this.connection.on('open', () => {
            this.isConnected = true;
            console.log('[DEBUG] Deepgram STT Connection Opened');
        });

        this.connection.on('Results', (data: any) => {
            const alt = data.channel?.alternatives?.[0];
            const transcript = alt?.transcript;
            if (transcript) {
                onTranscript(transcript, data.is_final, alt.confidence);
            }
        });

        this.connection.on('Metadata', (data: any) => {
            // Silenced metadata noise
        });

        this.connection.on('error', (err: any) => {
            console.error('[DEBUG] Deepgram STT Error event:', err);
        });

        this.connection.on('close', () => {
            this.isConnected = false;
            console.log('[DEBUG] Deepgram STT Connection Closed');
        });

        this.connection.on('speech_started', () => {
            console.log('[DEBUG] Deepgram Speech Started event');
            if (onSpeechStarted) onSpeechStarted();
        });

        this.connection.on('UtteranceEnd', (data: any) => {
            // Silenced UtteranceEnd noise
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
            if (typeof this.connection.requestClose === 'function') {
                this.connection.requestClose();
            } else if (typeof this.connection.finish === 'function') {
                this.connection.finish();
            }
            this.connection = null;
            this.isConnected = false;
        }
    }
}
