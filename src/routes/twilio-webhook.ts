import { Router } from 'express';
import { config } from '../config';
import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;
export const twilioWebhookRouter = Router();

twilioWebhookRouter.post('/voice', (req, res) => {
    const twiml = new VoiceResponse();

    // Connect to Media Stream
    const connect = twiml.connect();
    connect.stream({
        url: `wss://${req.headers.host}/media-stream`,
        // We can pass custom parameters like clientId here
        // For now, we hardcode it or extract from From number
    });

    res.type('text/xml');
    res.send(twiml.toString());
});
