import { Router, Request, Response } from 'express';
import { config } from '../../config';
import twilio from 'twilio';
import { voicemailRepository } from '../../db/repositories/voicemail-repository';
import { smsService } from '../../services/telephony/sms-service';
import { loadClientConfig } from '../../models/client-config';
import { validateTwilioRequest } from '../middleware/twilio-validator';

const VoiceResponse = twilio.twiml.VoiceResponse;
export const twilioWebhookRouter = Router();

twilioWebhookRouter.post('/voice', validateTwilioRequest, (req: Request, res: Response) => {
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid;
    const clientId = req.query.clientId as string || 'default';

    console.log(`📞 Incoming call (SID: ${callSid}) for Client: ${clientId}`);

    // Connect to Media Stream
    const connect = twiml.connect();
    connect.stream({
        url: `wss://${req.headers.host}/media-stream?callSid=${callSid}&clientId=${clientId}`,
    }).parameter({
        name: 'clientId',
        value: clientId
    });

    // Fallback: This TwiML will execute AFTER the Stream is disconnected
    // (either naturally or because the AI decided to take a message)
    twiml.say({ voice: 'Polly.Amy' }, 'I am sorry, I am having some trouble right now. Please leave a message after the tone.');
    twiml.record({
        action: `/voicemail-callback?clientId=${clientId}`,
        transcribe: true,
        transcribeCallback: `/voicemail-callback?clientId=${clientId}&type=transcription`,
        maxLength: 120,
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

twilioWebhookRouter.post('/status-callback', validateTwilioRequest, (req: Request, res: Response) => {
    // This route is for Twilio status updates, e.g., call completed.
    // The actual implementation for this route would go here.
    // For now, we'll just log the event.
    console.log('📞 Call Status Update:', req.body);
    res.status(200).send(); // Acknowledge Twilio's request
});

twilioWebhookRouter.post('/voicemail-callback', async (req: Request, res: Response) => {
    const { clientId, type } = req.query;
    const { CallSid, RecordingUrl, RecordingDuration, TranscriptionText } = req.body;

    console.log(`📩 Voicemail Update [${type || 'recording'}] (SID: ${CallSid})`);

    try {
        if (type === 'transcription') {
            // Update transcription text
            voicemailRepository.updateByCallSid(CallSid, {
                transcription_text: TranscriptionText
            });

            // Send SMS notification if configured
            const clientConfig = loadClientConfig(clientId as string);
            if (clientConfig.notifications?.sms) {
                await smsService.sendNotification(
                    clientConfig.notifications.sms,
                    `New Voicemail from ${req.body.From}: "${TranscriptionText.substring(0, 100)}..."`
                );
            }
        } else {
            // New recording entry
            voicemailRepository.create({
                call_sid: CallSid,
                client_id: clientId as string,
                recording_url: RecordingUrl,
                duration: parseInt(RecordingDuration as string)
            });
        }
    } catch (error) {
        console.error('Error handling voicemail callback:', error);
    }

    res.type('text/xml');
    res.send('<Response/>');
});
