import { SchedulerService } from '../scheduling/scheduler';

export class ToolExecutor {
    private scheduler = new SchedulerService();

    async execute(name: string, args: any, clientId: string): Promise<string> {
        console.log(`Executing tool: ${name}`, args);

        try {
            switch (name) {
                case 'check_availability':
                    const slots = await this.scheduler.checkAvailability(clientId, args.startTime, args.endTime);
                    if (slots.length === 0) return "That time slot is free.";
                    return "That time seems to be busy. Would you like to try another time?";

                case 'book_appointment':
                    const apptId = await this.scheduler.bookAppointment(clientId, {
                        customerName: args.customerName,
                        customerPhone: args.customerPhone,
                        startTime: args.startTime,
                        endTime: args.endTime,
                        description: args.description
                    });
                    return `Appointment booked successfully. Reference ID: ${apptId}`;

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
