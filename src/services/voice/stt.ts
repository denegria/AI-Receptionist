import { createClient } from '@deepgram/sdk';
import WebSocket from 'ws';
import { config } from '../../config';

export class DeepgramSTTService {
    private deepgram: ReturnType<typeof createClient>;
    private connection: any = null;
    private isConnected = false;
    private hasFluxFailed = false;

    private useFluxMode(): boolean {
        const mode = (process.env.DEEPGRAM_STT_MODE || '').toLowerCase();
        if (mode === 'flux') return true;
        if (mode === 'phonecall') return false;
        return config.deepgram.sttModel.startsWith('flux');
    }

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

        const startLegacy = () => {
            const fallbackModel = config.deepgram.sttModel.startsWith('flux') ? 'nova-2-phonecall' : config.deepgram.sttModel;
            this.connection = this.deepgram.listen.live({
                model: fallbackModel,
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

            this.connection.on('Metadata', (_data: any) => {
                // Silenced metadata noise
            });

            this.connection.on('error', (err: any) => {
                console.error('[DEBUG] Deepgram STT Error event:', err?.message || err);
            });

            this.connection.on('close', () => {
                this.isConnected = false;
                console.log('[DEBUG] Deepgram STT Connection Closed');
            });

            this.connection.on('speech_started', () => {
                console.log('[DEBUG] Deepgram Speech Started event');
                if (onSpeechStarted) onSpeechStarted();
            });

            this.connection.on('UtteranceEnd', (_data: any) => {
                // Silenced UtteranceEnd noise
            });
        };

        if (this.useFluxMode() && !this.hasFluxFailed) {
            // Keep Flux handshake minimal to avoid 400 on unsupported params.
            const params = new URLSearchParams({
                model: 'flux-general-en',
                encoding: 'mulaw',
                sample_rate: '8000',
            });

            const wsUrl = `wss://api.deepgram.com/v2/listen?${params.toString()}`;
            this.connection = new WebSocket(wsUrl, {
                headers: {
                    Authorization: `Token ${config.deepgram.apiKey}`,
                },
            });

            this.connection.on('open', () => {
                this.isConnected = true;
                console.log('[DEBUG] Deepgram Flux STT Connection Opened');
            });

            this.connection.on('message', (raw: WebSocket.RawData) => {
                try {
                    const data = JSON.parse(raw.toString());
                    const type = data?.type;

                    if (type === 'Results') {
                        const alt = data.channel?.alternatives?.[0];
                        const transcript = alt?.transcript;
                        if (transcript) {
                            onTranscript(transcript, !!data.is_final, alt.confidence);
                        }
                        return;
                    }

                    if (type === 'SpeechStarted') {
                        if (onSpeechStarted) onSpeechStarted();
                        return;
                    }

                    // Flux-specific turn signals (reserved for future eager-turn optimization)
                    if (type === 'EndOfTurn' || type === 'EagerEndOfTurn' || type === 'TurnResumed') {
                        return;
                    }
                } catch {
                    // ignore malformed/non-json messages
                }
            });

            this.connection.on('error', (err: any) => {
                console.error('[DEBUG] Deepgram Flux STT Error event:', err?.message || err);
                if (!this.isConnected && !this.hasFluxFailed) {
                    this.hasFluxFailed = true;
                    console.warn('[DEBUG] Flux handshake failed; falling back to legacy live STT');
                    startLegacy();
                }
            });

            this.connection.on('close', () => {
                this.isConnected = false;
                console.log('[DEBUG] Deepgram Flux STT Connection Closed');
            });

            return;
        }

        startLegacy();
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
            } else if (typeof this.connection.close === 'function') {
                this.connection.close();
            }
            this.connection = null;
            this.isConnected = false;
        }
    }
}
