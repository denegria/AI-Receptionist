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
                model: 'aura-asteria-en', // Use a high-quality Aura voice
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
}
