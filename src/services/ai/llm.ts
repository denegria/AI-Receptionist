import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { TOOLS } from '../../functions/tools';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | any[];
    tool_use_id?: string;
}

export class LLMService {
    private anthropic: Anthropic;
    private systemPrompt: string = `You are a helpful, professional AI receptionist for a service business. 
    Your goal is to gather information from the caller to book an appointment or answer questions.
    Keep your responses short, conversational, and encouraging. 
    Do not be verbose. 
    If you need to book an appt, ask for name, phone, and preferred time.
    Current Time: ${new Date().toISOString()}`;

    constructor() {
        if (!config.ai.anthropicApiKey) {
            console.warn("Anthropic API Key is missing!");
        }
        this.anthropic = new Anthropic({
            apiKey: config.ai.anthropicApiKey || 'dummy_key',
        });
    }

    async generateResponse(history: ChatMessage[], newSystemPrompt?: string): Promise<any> {
        const messages = history.filter(m => m.role !== 'system').map(m => {
            if (m.role === 'tool') {
                return {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: m.tool_use_id,
                            content: m.content
                        }
                    ]
                };
            }
            return {
                role: m.role,
                content: m.content
            };
        }) as any;

        const system = newSystemPrompt || this.systemPrompt;

        try {
            const response = await this.anthropic.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: 500,
                system: system,
                messages: messages,
                tools: TOOLS as any,
                temperature: 0.5,
            });

            return response;
        } catch (error) {
            console.error("LLM Generation Error:", error);
            throw error;
        }
    }
}
