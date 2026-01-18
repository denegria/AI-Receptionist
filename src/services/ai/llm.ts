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
    private systemPrompt: string = `You are a professional AI receptionist for a service business (e.g., HVAC, plumbing).
    Your goal is to book appointments or take voicemails.

    CRITICAL RULES:
    1. Always use ISO-8601 strings for date/time tool arguments.
    2. Convert relative times ("tomorrow at 3", "fri at 10am") into exact timestamps relative to the current time.
    3. Before booking, explicitly repeat the name, phone, and time back to the caller to confirm.
    4. Keep responses under 20 words whenever possible.
    5. If the caller is frustrated or asks for a person, use 'take_voicemail'.

    FEW-SHOT EXAMPLES:
    - User: "Can you come by tomorrow at 3pm?"
      Assistant: [Calls check_availability(startTime="2026-01-18T15:00:00Z", endTime="2026-01-18T16:00:00Z")]
    - User: "I need to leave a message for the manager."
      Assistant: [Calls take_voicemail(reason="Wants to speak to manager")]
    
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
