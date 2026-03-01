import { SchedulerService } from '../scheduling/scheduler';

export class ToolExecutor {
    private scheduler = new SchedulerService();

    private normalizePhone(input?: string): string | null {
        if (!input) return null;
        const digitWords: Record<string, string> = {
            zero: '0', oh: '0', one: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4',
            five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9'
        };
        const cleaned = input.toLowerCase()
            .replace(/\b(my number is|phone number is|it's|it is|you can reach me at)\b/g, ' ')
            .replace(/[^a-z0-9 ]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(tok => digitWords[tok] ?? tok)
            .join('');
        const digits = cleaned.replace(/\D/g, '');
        return digits.length >= 10 ? digits : null;
    }

    private normalizeEmail(input?: string): string | null {
        if (!input) return null;
        const normalized = input.toLowerCase()
            .replace(/\b(my email is|email is|it's|it is)\b/g, ' ')
            .replace(/\s+at\s+/g, '@')
            .replace(/\s+dot\s+/g, '.')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9@._+-]/g, '');
        return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized) ? normalized : null;
    }

    async execute(name: string, args: any, clientId: string): Promise<string> {
        console.log(`Executing tool: ${name}`, args);

        try {
            switch (name) {
                case 'check_availability':
                    const slots = await this.scheduler.checkAvailability(clientId, args.startTime, args.endTime);
                    if (slots.length === 0) {
                        return "That entire time range is free.";
                    }
                    // Return the busy slots so AI can work around them
                    const busyTimes = slots.map(s => {
                        const start = new Date(s.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                        const end = new Date(s.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                        return `${start}-${end}`;
                    }).join(', ');
                    return `I have existing appointments at: ${busyTimes}. Times outside of these are available.`;

                case 'book_appointment': {
                    const customerName = typeof args.customerName === 'string' ? args.customerName.trim() : '';
                    const customerPhone = this.normalizePhone(args.customerPhone);
                    const customerEmail = this.normalizeEmail(args.customerEmail);

                    if (!customerName || !customerPhone || !customerEmail) {
                        return `Error: missing_or_invalid_booking_fields (name=${!!customerName}, phone=${!!customerPhone}, email=${!!customerEmail})`;
                    }

                    const apptId = await this.scheduler.bookAppointment(clientId, {
                        customerName,
                        customerPhone,
                        customerEmail,
                        startTime: args.startTime,
                        endTime: args.endTime,
                        description: args.description
                    });
                    return `Appointment booked successfully. Reference ID: ${apptId}`;
                }

                case 'take_voicemail':
                    // We return a specific token that StreamHandler will recognize to stop the stream
                    return 'TRIGGER_VOICEMAIL_FALLBACK';

                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (error: any) {
            console.error(`Tool execution error [${name}]:`, error);
            return `Error: ${error.message}`;
        }
    }
}
