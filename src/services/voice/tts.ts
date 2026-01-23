import { createClient } from '@deepgram/sdk';
import { config } from '../../config';

export class DeepgramTTSService {
    private deepgram: ReturnType<typeof createClient>;

    constructor() {
        this.deepgram = createClient(config.deepgram.apiKey);
    }

    /**
     * Generates audio from text stream
     * @param text Text to speak
     * @returns Audio buffer (mp3 by default, but we might need mulaw for Twilio)
     */
    public async generate(text: string): Promise<Buffer> {
        const response = await this.deepgram.speak.request(
            { text },
            {
                model: 'aura-asteria-en', // Use the most stable Aura voice
                encoding: 'mulaw',        // Streaming direct to Twilio requires mulaw/8000 usually
                sample_rate: 8000,
                container: 'none',        // Raw audio for media streams
            }
        );

        const stream = await response.getStream();
        if (!stream) {
            throw new Error('Error generating audio: No stream returned');
        }

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }

        return Buffer.concat(chunks);
    }

    /**
     * Generates audio stream from text
     * Yields audio chunks as they are received from Deepgram
     */
    public async *generateStream(text: string): AsyncGenerator<Buffer> {
        try {
            const response = await this.deepgram.speak.request(
                { text },
                {
                    model: 'aura-asteria-en',
                    encoding: 'mulaw',
                    sample_rate: 8000,
                    container: 'none',
                }
            );

            const stream = await response.getStream();
            if (!stream) {
                throw new Error('Error generating audio: No stream returned');
            }

            const reader = stream.getReader();
            let chunkCount = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunkCount++;
                    if (chunkCount === 1) console.log(`[DEBUG] FIRST audio chunk generated for: "${text.substring(0, 20)}..."`);
                    yield Buffer.from(value);
                }
            }
            console.log(`[DEBUG] Finished generateStream for: "${text.substring(0, 20)}..." (${chunkCount} chunks)`);
        } catch (error) {
            console.error('Deepgram TTS Stream Error:', error);
            throw error;
        }
    }

    /**
     * Creates a live TTS session for continuous streaming
     */
    public createLiveSession(onAudio: (chunk: Buffer) => void) {
        const live = this.deepgram.speak.live({
            model: 'aura-stella-en',
            encoding: 'mulaw',
            sample_rate: 8000,
            container: 'none',
        });

        live.on('open', () => console.log('[DEBUG] Deepgram TTS Live Session Opened'));
        live.on('close', () => console.log('[DEBUG] Deepgram TTS Live Session Closed'));
        live.on('error', (err: any) => console.error('[DEBUG] Deepgram TTS Live Error:', err));

        // Listen for both event name styles
        const handleAudio = (data: any, source: string) => {
            if (data) {
                if (Math.random() < 0.1) console.log(`[DEBUG] Received TTS ${source}: ${data.length || (data.data ? data.data.length : 'unknown')} bytes`);
                const buffer = data instanceof Buffer ? data : (data.data ? Buffer.from(data.data) : null);
                if (buffer) onAudio(buffer);
            }
        };

        live.on('AudioData', (data: any) => handleAudio(data, 'AudioData'));
        (live as any).on('audio', (data: any) => handleAudio(data, 'audio'));

        return {
            send: (text: string) => live.sendText(text),
            finish: () => (live as any).requestClose()
        };
    }

    /**
     * Bi-directional streaming (Text Stream -> Audio Callback)
     * Uses Deepgram WebSocket API for lowest latency
     */
    public async stream(
        textStream: AsyncIterable<string>,
        onAudio: (chunk: Buffer) => void,
        onError?: (err: any) => void
    ): Promise<void> {
        try {
            const live = this.createLiveSession(onAudio);

            // Iterate tokens and send to Deepgram
            for await (const text of textStream) {
                if (text) live.send(text);
            }

            live.finish();
        } catch (error) {
            console.error('Deepgram TTS Live Setup Error:', error);
            if (onError) onError(error);
        }
    }
}
