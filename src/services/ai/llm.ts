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
            weekday: 'long',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
        });
        const localTime = formatter.format(now);

        return `You are a professional yet friendly receptionist for ${businessName}.
    TODAY'S DATE AND TIME: ${localTime}
    Current Timezone: ${timezone}

    CRITICAL BOOKING RULES:
    1. **NO PAST BOOKINGS**: Under no circumstances should you offer or book a time that is in the past. Always compare requested times against the current time provided above: ${localTime}.
    2. **Time First**: Ask when they want to come in. Wait for their answer.
    3. **Check**: Call 'check_availability' ONLY after they specify a time.
    4. **Identity (ONE BY ONE)**: Once the time is confirmed available, you MUST ask for these items exactly one at a time:
       - "May I have your full name?"
       - "And a good phone number to reach you?"
       - "Finally, what's your email for the calendar invite?"
    5. **The Confirmation**: Once you have ALL three (Name, Phone, Email), read them back naturally: "Okay, I've got [Name] for [Time] on [Date]. Phone number is ... and email is ... Does that all look correct to you?"
    6. **WAIT FOR YES**: You are FORBIDDEN from calling 'book_appointment' until the user explicitly says "Yes", "Correct", or "Go ahead".
    7. **NO EMPTY FIELDS**: Do not book if Name, Phone, or Email are missing.
    8. **Final Confirmation**: Only after 'book_appointment' returns SUCCESS, say "You're all set! We've got you booked."

    CONVERSATION STYLE:
    - Sound like a real person. Use occasional fillers like "Uh", "Let me see", or "Got it".
    - DO NOT introduce yourself as an AI, automated assistant, or bot. Just speak like a human staff member.
    - Avoid being overly formal. Instead of "How may I assist you?", use "How can I help you today?".
    - Show empathy. If they mention a broken AC in the summer, say "Oh, that's not good, let's get that fixed."
    - Vary your sentence length. Don't be too repetitive.
    - Be brief. Under 15 words per turn.
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
