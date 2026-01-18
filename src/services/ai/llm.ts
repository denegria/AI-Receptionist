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
    private getSystemPrompt(businessName: string, timezone: string): string {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        });
        const localTime = formatter.format(now);
        const offset = -now.getTimezoneOffset() / 60; // Simple offset check
        const offsetString = (offset >= 0 ? '+' : '-') + Math.floor(Math.abs(offset / 10)).toString() + (Math.abs(offset % 10)).toString() + ':00';

        return `You are a professional receptionist for ${businessName}.
    Current Local Time in ${timezone}: ${localTime}
    Current ISO (UTC): ${now.toISOString()}

    MANDATORY BOOKING PROTOCOL:
    1. **Time First**: Ask when they want to come in. Wait for their answer.
    2. **Check**: Call 'check_availability' ONLY after they specify a time.
    3. **Identity (One by One)**: Once confirmed free, ask for Name, then Phone, then Email.
    4. **The Confirmation**: Read the details back naturally (e.g., "Alright, I've got you down for Dick Cheney at 9 AM on Monday. Your number is... and email is..."). DO NOT list field names like "Name: " or "Phone: ".
    5. **WAIT FOR YES**: You are FORBIDDEN from calling 'book_appointment' until the user explicitly says "Yes", "Correct", or "Go ahead" after you read the details back.
    6. **Mandatory Success**: Only say "It's booked" after the tool returns success.

    CRITICAL RULES:
    - Sound like a human. Avoid "Wonderful", "Great", "Perfect", "Understood", "Got it". 
    - Use "Sure", "Okay", "Checking that now", or just answer.
    - Be brief. Under 15 words per turn.
    - TIMEZONE: You must use the Local Time (${localTime}) to calculate dates.
    - When calling 'book_appointment', use the format 'YYYY-MM-DDTHH:mm:SS-05:00' for Eastern Time.
    - If caller is frustrated, call 'take_voicemail'.
`;
    }

    constructor() {
        if (!config.ai.anthropicApiKey) {
            console.warn("Anthropic API Key is missing!");
        }
        this.anthropic = new Anthropic({
            apiKey: config.ai.anthropicApiKey || 'dummy_key',
        });
    }

    async generateResponse(history: ChatMessage[], context?: { businessName: string, timezone: string }): Promise<any> {
        const messages = history.filter(m => m.role !== 'system').map(m => {
            // ... (rest of the map logic)
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

        const system = this.getSystemPrompt(
            context?.businessName || 'a service business',
            context?.timezone || 'UTC'
        );

        try {
            console.log(`[DEBUG] Calling Anthropic with ${messages.length} messages`);
            const response = await this.anthropic.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: 500,
                system: system,
                messages: messages,
                tools: TOOLS as any,
                temperature: 0.1, // Lower temperature for more consistent tool use
            });

            console.log('[DEBUG] Anthropic Raw Response:', JSON.stringify(response.content));
            return response;
        } catch (error) {
            console.error("LLM Generation Error:", error);
            throw error;
        }
    }
}
