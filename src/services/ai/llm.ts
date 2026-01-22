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
    Current Timezone: America/New_York

    MANDATORY BOOKING PROTOCOL:
    1. **Time First**: Ask when they want to come in. Wait for their answer.
    2. **Check**: Call 'check_availability' ONLY after they specify a time.
    3. **Identity (ONE BY ONE)**: Once the time is confirmed available, you MUST ask for these items exactly one at a time:
       - "May I have your full name?"
       - "And a good phone number to reach you?"
       - "Finally, what's your email for the calendar invite?"
    4. **The Confirmation**: Once you have ALL three (Name, Phone, Email), read them back naturally: "Okay, I have Dick Cheney at 9 AM on Monday. Phone is ... and email is ... Does that look correct?"
    5. **WAIT FOR YES**: You are FORBIDDEN from calling 'book_appointment' until the user explicitly says "Yes", "Correct", or "Go ahead" after you read the details back.
    6. **NO EMPTY FIELDS**: You are strictly PROHIBITED from calling 'book_appointment' if the Name, Phone, or Email fields are missing or empty strings.
    7. **Final Confirmation**: Only after 'book_appointment' returns SUCCESS, say "It's booked."

    CRITICAL RULES:
    - Sound like a human. No "Wonderful", "Perfect", "Great". Use "Sure", "Okay", or just answer.
    - Be brief. Under 12 words per turn.
    - TIMEZONE: Eastern Time (-05:00).
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

    async *generateStream(history: ChatMessage[], context?: { businessName: string, timezone: string }): AsyncGenerator<Anthropic.MessageStreamEvent> {
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

        const system = this.getSystemPrompt(
            context?.businessName || 'a service business',
            context?.timezone || 'UTC'
        );

        try {
            console.log(`[DEBUG] Starting LLM Stream with ${messages.length} messages`);
            const stream = this.anthropic.messages.stream({
                model: 'claude-3-haiku-20240307',
                max_tokens: 500,
                system: system,
                messages: messages,
                tools: TOOLS as any,
                temperature: 0.1,
            });

            for await (const event of stream) {
                yield event;
            }
        } catch (error) {
            console.error("LLM Stream Error:", error);
            throw error;
        }
    }
}
