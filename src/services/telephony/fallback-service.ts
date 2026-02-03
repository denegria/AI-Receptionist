import { Twilio } from 'twilio';
import { config } from '../../config';
import { callLogRepository } from '../../db/repositories/call-log-repository';

export enum FallbackLevel {
    LEVEL_1_SOFT = 'SOFT_RESET', // "Let me double check..."
    LEVEL_2_HARD = 'HARD_FAIL',  // "I'm having trouble hearing..."
    LEVEL_3_CRASH = 'SYSTEM_CRASH' // Exception / 500 Error
}

export class FallbackService {
    private twilioClient: Twilio;

    constructor() {
        this.twilioClient = new Twilio(config.twilio.accountSid, config.twilio.authToken);
    }

    public async handleFallback(level: FallbackLevel, callSid: string, callerPhone: string, errorMessage?: string): Promise<string> {
        console.error(`[FALLBACK] Triggered Level: ${level} for Call ${callSid}. Error: ${errorMessage}`);

        // Update DB
        callLogRepository.update(callSid, {
            call_status: 'failed',
            error_message: `${level}: ${errorMessage || 'Unknown Error'}`
        });

        // Level 1: Just log, return prompt for AI to say
        if (level === FallbackLevel.LEVEL_1_SOFT) {
            return "I apologize, I want to make sure I get this right. Could you please repeal that one more time?";
        }

        // Level 2 & 3: Trigger SMS Handoff
        if (level === FallbackLevel.LEVEL_2_HARD || level === FallbackLevel.LEVEL_3_CRASH) {
            await this.sendHandoffSMS(callerPhone);
            await this.notifyBusinessOwner(callerPhone, errorMessage);

            // Return final phrase for TTS before hangup
            return "I'm having a bit of trouble with the connection. I've just sent you a text message so we can continue there. Goodbye!";
        }

        return "Goodbye.";
    }

    private async sendHandoffSMS(phoneNumber: string) {
        if (!config.features.smsNotifications) return;

        try {
            await this.twilioClient.messages.create({
                body: `Hi, this is ${config.twilio.phoneNumber}. We had a bad connection on our call. How can we help you? Reply here to chat with us.`,
                from: config.twilio.phoneNumber,
                to: phoneNumber
            });
            console.log(`[FALLBACK] Sent Handoff SMS to ${phoneNumber}`);
        } catch (error) {
            console.error('[FALLBACK] Failed to send SMS:', error);
        }
    }

    private async notifyBusinessOwner(callerPhone: string, error?: string) {
        const ownerPhone = process.env.BUSINESS_OWNER_PHONE; // Would normally be in ClientConfig
        if (!ownerPhone) return;

        try {
            await this.twilioClient.messages.create({
                body: `⚠️ AI Call Failed\nCaller: ${callerPhone}\nError: ${error || 'Unknown'}\nAction: SMS Handoff triggered.`,
                from: config.twilio.phoneNumber,
                to: ownerPhone
            });
        } catch (e) {
            console.error('[FALLBACK] Failed to notify owner:', e);
        }
    }
}

export const fallbackService = new FallbackService();
