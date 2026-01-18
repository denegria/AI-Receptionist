import twilio from 'twilio';
import { config } from '../../config';

export class SMSService {
    private client: twilio.Twilio;

    constructor() {
        this.client = twilio(config.twilio.accountSid, config.twilio.authToken);
    }

    async sendNotification(to: string, message: string): Promise<void> {
        if (!config.features.smsNotifications) {
            console.log('SMS notifications are disabled.');
            return;
        }

        try {
            await this.client.messages.create({
                body: message,
                from: config.twilio.phoneNumber, // You might need a specific from number from config
                to: to
            });
            console.log(`✓ SMS notification sent to ${to}`);
        } catch (error) {
            console.error('Failed to send SMS notification:', error);
        }
    }
}

export const smsService = new SMSService();
