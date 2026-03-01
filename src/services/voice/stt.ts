import { createClient } from '@deepgram/sdk';
import WebSocket from 'ws';
import { config } from '../../config';

export class DeepgramSTTService {
    private deepgram: ReturnType<typeof createClient>;
    private connection: any = null;
    private isConnected = false;
    private hasFluxFailed = false;
    private fluxActive = false;
    private fluxChunkBuffer: Buffer[] = [];
    private fluxBufferedBytes = 0;
    private fluxEventLogCount = 0;

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
            this.fluxActive = false;
            this.fluxChunkBuffer = [];
            this.fluxBufferedBytes = 0;
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
            let receivedTranscript = false;
            // Keep Flux handshake minimal to avoid 400 on unsupported params.
            const params = new URLSearchParams({
                model: 'flux-general-en',
                encoding: 'mulaw',
                sample_rate: '8000',
            });

            const wsUrl = `wss://api.deepgram.com/v2/listen?${params.toString()}`;
            // Flux docs JS example uses WebSocket subprotocol auth: ['token', API_KEY]
            this.connection = new WebSocket(wsUrl, ['token', config.deepgram.apiKey]);

            this.connection.on('open', () => {
                this.isConnected = true;
                this.fluxActive = true;
                this.fluxEventLogCount = 0;
                console.log('[DEBUG] Deepgram Flux STT Connection Opened');

                // Safety: if Flux opens but yields no transcripts, fail over to proven phonecall STT.
                setTimeout(() => {
                    if (!receivedTranscript && this.connection && this.isConnected && !this.hasFluxFailed) {
                        this.hasFluxFailed = true;
                        this.fluxActive = false;
                        console.warn('[DEBUG] Flux open but no transcripts; falling back to legacy live STT');
                        try { this.connection.close?.(); } catch {}
                        this.isConnected = false;
                        startLegacy();
                    }
                }, 5000);
            });

            this.connection.on('message', (raw: WebSocket.RawData) => {
                try {
                    const data = JSON.parse(raw.toString());
                    const type = data?.type;
                    if (type && this.fluxEventLogCount < 10) {
                        this.fluxEventLogCount += 1;
                        console.log('[DEBUG] Flux event type:', type);
                    }

                    if (type === 'Results') {
                        const alt = data.channel?.alternatives?.[0];
                        const transcript = alt?.transcript;
                        if (transcript) {
                            receivedTranscript = true;
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
                    this.fluxActive = false;
                    console.warn('[DEBUG] Flux handshake failed; falling back to legacy live STT');
                    startLegacy();
                }
            });

            this.connection.on('close', () => {
                this.isConnected = false;
                this.fluxActive = false;
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
        if (!this.connection || !this.isConnected) return;

        // Flux docs recommend ~80ms chunks for best turn-taking behavior.
        // Twilio packets are typically 20ms, so batch 4 packets (mulaw 8k => 160 bytes/20ms; target 640 bytes).
        if (this.fluxActive) {
            const TARGET_BYTES = 640;
            this.fluxChunkBuffer.push(audio);
            this.fluxBufferedBytes += audio.length;

            while (this.fluxBufferedBytes >= TARGET_BYTES) {
                const merged = Buffer.concat(this.fluxChunkBuffer);
                const frame = merged.subarray(0, TARGET_BYTES);
                const rest = merged.subarray(TARGET_BYTES);
                this.connection.send(frame);
                this.fluxChunkBuffer = rest.length ? [rest] : [];
                this.fluxBufferedBytes = rest.length;
            }
            return;
        }

        this.connection.send(audio);
    }

    /**
     * Closes the connection
     */
    public stop(): void {
        if (this.connection) {
            if (this.fluxActive && this.fluxBufferedBytes > 0) {
                try {
                    const merged = Buffer.concat(this.fluxChunkBuffer);
                    if (merged.length) this.connection.send(merged);
                } catch {
                    // ignore final flush errors
                }
            }
            if (typeof this.connection.requestClose === 'function') {
                this.connection.requestClose();
            } else if (typeof this.connection.finish === 'function') {
                this.connection.finish();
            } else if (typeof this.connection.close === 'function') {
                this.connection.close();
            }
            this.connection = null;
            this.isConnected = false;
            this.fluxActive = false;
            this.fluxChunkBuffer = [];
            this.fluxBufferedBytes = 0;
        }
    }
}
