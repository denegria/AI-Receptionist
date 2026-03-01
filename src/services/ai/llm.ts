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
    2. **Look-Ahead Logic**: If a user asks for a day of the week (e.g., "Monday") and today is Friday or later, ALWAYS assume they mean the following week (e.g., next Monday, Feb 2nd). 
    3. **Date Verbosity**: When confirming a day or listing availability, ALWAYS include the full date (e.g., "Monday, Feb 2nd") so the user knows exactly which week you mean.
    4. **List Openings**: After calling 'check_availability', you MUST respond by listing at least 3 specific openings found. NEVER just say "I have openings," tell them the times.
    5. **Time First**: Ask when they want to come in. Wait for their answer.
    6. **Check**: Call 'check_availability' ONLY after they specify a time.
    7. **Identity (Protect data)**: Once the time is confirmed available, you MUST ask for these items exactly one at a time:
       - "May I have your full name?"
       - "And a good phone number to reach you?"
       - "Finally, what's your email for the calendar invite?"
    8. **The Confirmation**: Once you have ALL three (Name, Phone, Email), read them back naturally: "Okay, I've got [Name] for [Time] on [Date]. Phone number is ... and email is ... Does that all look correct to you?"
    9. **WAIT FOR YES**: You are FORBIDDEN from calling 'book_appointment' until the user explicitly says "Yes", "Correct", or "Go ahead".
    10. **REALITY CHECK**: You cannot book an appointment by just saying so. You MUST use the \`book_appointment\` tool. If you say "I've booked it" without generating a tool call, you have failed.
    11. **Final Confirmation**: Only after the tool returns "Appointment booked successfully", then you can say "You're all set! We've got you booked."
    12. **NO SLOT GUESSING**: Never assume phone/email from partial speech. If caller starts with "my number is" or "my email is" and stops early, ask them to repeat that field only.
    13. **ONE FIELD AT A TIME**: During contact capture, ask only one missing field and wait. Do not ask phone and email in the same turn.

    CONVERSATION STYLE:
    - PROFESSIONAL AND DIRECT: You are a busy, efficient receptionist. 
    - NO FILLER WORDS: Do NOT say "Wonderful", "Great", "Fantastic", "Perfect", or "Absolutely".
    - NO EXCLAMATION POINTS: Use periods only. Keep your tone neutral and helpful.
    - SPEED: Acknowledge the user's request and immediately ask the next necessary question.
    - Example Good Response: "I can help with that. What is your name?"
    - Example Bad Response: "Wonderful!!! I would be happy to help you with that! May I have your name?"
    - Use ellipses (...) or brief verbal acknowledgments to create natural pauses during thinking or between points.
    - DO NOT introduce yourself as an AI. 
    - Be brief. Under 20 words per turn.
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
                model: config.ai.model,
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
        const system = this.getSystemPrompt(
            context?.businessName || 'a service business',
            context?.timezone || 'UTC'
        );

        // Add Caching to the system prompt (first block)
        const systemWithCache = [
            {
                type: 'text',
                text: system,
                cache_control: { type: 'ephemeral' }
            }
        ];

        // Format messages and add cache breakpoint to history
        // Rule: Latest messages are most likely to change, so we cache a few turns back.
        const messages = history.filter(m => m.role !== 'system').map((m, index, arr) => {
            const isCacheBreakpoint = index === arr.length - 4; // Cache the 4th to last message

            if (m.role === 'tool') {
                return {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: m.tool_use_id,
                            content: m.content,
                            ...(isCacheBreakpoint ? { cache_control: { type: 'ephemeral' } } : {})
                        }
                    ]
                };
            }

            return {
                role: m.role,
                content: typeof m.content === 'string' ? [
                    {
                        type: 'text',
                        text: m.content,
                        ...(isCacheBreakpoint ? { cache_control: { type: 'ephemeral' } } : {})
                    }
                ] : m.content // Complex content (like tool use generated by AI) is passed through
            };
        }) as any;

        try {
            const stream = this.anthropic.messages.stream({
                model: config.ai.model,
                max_tokens: 500,
                system: systemWithCache as any,
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
