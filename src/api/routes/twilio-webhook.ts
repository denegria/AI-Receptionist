import { Router, Request, Response } from 'express';
import { config } from '../../config';
import twilio from 'twilio';
import { voicemailRepository } from '../../db/repositories/voicemail-repository';
import { callLogRepository } from '../../db/repositories/call-log-repository';
import { smsService } from '../../services/telephony/sms-service';
import { loadClientConfig } from '../../models/client-config';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { validateTwilioRequest } from '../middleware/twilio-validator';
import { redisCoordinator } from '../../services/coordination/redis-coordinator';
import { logger } from '../../services/logging';
import crypto from 'crypto';

const VoiceResponse = twilio.twiml.VoiceResponse;
export const twilioWebhookRouter = Router();


function webhookKey(req: Request, suffix: string): string {
    const parts = [
        req.path,
        suffix,
        req.body.CallSid,
        req.body.RecordingUrl,
        req.body.CallStatus,
        req.query.clientId,
        req.query.type,
    ];
    return crypto.createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex');
}

function resolveClientId(req: Request): string | null {
    const fromQuery = (req.query.clientId as string | undefined)?.trim();
    if (fromQuery) return fromQuery;

    const toNumber = (req.body.To as string | undefined)?.trim();
    if (!toNumber) return null;

    const byPhone = clientRegistryRepository.findByPhone(toNumber);
    return byPhone?.id ?? null;
}

function canServeClient(clientId: string): { ok: boolean; reason?: string } {
    const entry = clientRegistryRepository.findById(clientId);
    if (!entry) return { ok: false, reason: 'client_not_found' };

    if (entry.status === 'suspended') return { ok: false, reason: 'client_suspended' };

    return { ok: true };
}

function buildStreamUrl(req: Request, callSid: string, clientId: string): string {
    const configuredPublicUrl = process.env.PUBLIC_URL?.trim();
    if (configuredPublicUrl) {
        const base = new URL(configuredPublicUrl);
        base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
        base.pathname = '/media-stream';
        base.search = '';
        base.searchParams.set('callSid', callSid);
        base.searchParams.set('clientId', clientId);
        return base.toString();
    }

    const host = req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const wsProto = proto === 'https' ? 'wss' : 'ws';
    return `${wsProto}://${host}/media-stream?callSid=${encodeURIComponent(callSid)}&clientId=${encodeURIComponent(clientId)}`;
}

async function handleVoice(req: Request, res: Response) {
    const fresh = await redisCoordinator.markWebhookProcessed(webhookKey(req, 'voice'));
    if (!fresh) return res.status(200).send('<Response/>');
    const twiml = new VoiceResponse();
    const callSid = req.body.CallSid;
    const clientId = resolveClientId(req);

    if (!clientId) {
        twiml.say({ voice: 'Polly.Amy' }, 'We are unable to route your call right now. Please try again later.');
        twiml.hangup();
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    const serve = canServeClient(clientId);
    if (!serve.ok) {
        logger.trackMetric(clientId, 'voice_webhook_error');
        twiml.say({ voice: 'Polly.Amy' }, 'Your account is currently unavailable. Please contact support.');
        twiml.hangup();
        res.type('text/xml');
        return res.send(twiml.toString());
    }

    logger.trackMetric(clientId, 'voice_webhook_ok');

    console.log(`📞 Incoming call (SID: ${callSid}) for Client: ${clientId}`);

    const streamUrl = buildStreamUrl(req, callSid, clientId);
    console.log(`📡 Connecting to Stream: ${streamUrl}`);

    const connect = twiml.connect();
    connect.stream({
        url: streamUrl,
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
}

twilioWebhookRouter.post('/voice', validateTwilioRequest, handleVoice);
twilioWebhookRouter.post('/api/twilio/voice', validateTwilioRequest, handleVoice);
// Backward-compatible alias for legacy configured numbers
twilioWebhookRouter.post('/api/twilio/webhook', validateTwilioRequest, handleVoice);

twilioWebhookRouter.post('/status-callback', validateTwilioRequest, async (req: Request, res: Response) => {
    const fresh = await redisCoordinator.markWebhookProcessed(webhookKey(req, 'status'));
    if (!fresh) return res.status(200).send();
    // This route is for Twilio status updates, e.g., call completed.
    // The actual implementation for this route would go here.
    // For now, we'll just log the event.
    console.log('📞 Call Status Update:', req.body);
    res.status(200).send(); // Acknowledge Twilio's request
});

twilioWebhookRouter.post('/voicemail-callback', validateTwilioRequest, async (req: Request, res: Response) => {
    const fresh = await redisCoordinator.markWebhookProcessed(webhookKey(req, 'voicemail'));
    if (!fresh) return res.status(200).send('<Response/>');
    const { clientId, type } = req.query;
    const { CallSid, RecordingUrl, RecordingDuration, TranscriptionText } = req.body;

    console.log(`📩 Voicemail Update [${type || 'recording'}] (SID: ${CallSid})`);

    if (!clientId || typeof clientId !== 'string') {
        console.warn('Voicemail callback missing clientId', { CallSid, type });
        return res.type('text/xml').send('<Response/>');
    }

    try {
        if (type === 'transcription') {
            // Update transcription text
            voicemailRepository.updateByCallSid(clientId as string, CallSid, {
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
            // New recording entry (usually fallback path after stream disconnect)
            if (clientId) {
                logger.trackMetric(clientId as string, 'fallback_triggered');

                // Ensure parent call log exists before voicemail insert (FK: voicemails.call_sid -> call_logs.call_sid)
                try {
                    callLogRepository.create({
                        client_id: clientId as string,
                        call_sid: CallSid,
                        caller_phone: (req.body.From as string) || 'unknown',
                        call_direction: 'inbound',
                        call_status: 'completed'
                    });
                } catch (e: any) {
                    // Ignore duplicate call_sid; rethrow anything else
                    const message = e?.message || '';
                    if (!message.includes('UNIQUE constraint failed')) {
                        throw e;
                    }
                }
            }

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
