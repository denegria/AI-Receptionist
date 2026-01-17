import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class LLMService {
    private anthropic: Anthropic;
    private systemPrompt: string = `You are a helpful, professional AI receptionist for a service business. 
    Your goal is to gather information from the caller to book an appointment or answer questions.
    Keep your responses short, conversational, and encouraging. 
    Do not be verbose. 
    If you need to book an appt, ask for name, phone, and preferred time.`;

    constructor() {
        if (!config.ai.anthropicApiKey) {
            console.warn("Anthropic API Key is missing!");
        }
        this.anthropic = new Anthropic({
            apiKey: config.ai.anthropicApiKey || 'dummy_key', // prevent crash on init if missing, but will fail calls
        });
    }

    async generateResponse(history: ChatMessage[], newSystemPrompt?: string): Promise<string> {
        const messages = history.filter(m => m.role !== 'system') as any; // Anthropic SDK format

        const system = newSystemPrompt || this.systemPrompt;

        try {
            const response = await this.anthropic.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: 300,
                system: system,
                messages: messages,
                temperature: 0.7,
            });

            // Extract text from ContentBlock
            const content = response.content[0];
            if (content.type === 'text') {
                return content.text;
            }
            return "";
        } catch (error) {
            console.error("LLM Generation Error:", error);
            return "I'm sorry, I'm having trouble connecting right now. Can you please say that again?";
        }
    }
}
