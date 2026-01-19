import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

export function validateTwilioRequest(req: Request, res: Response, next: NextFunction) {
    const signature = req.headers['x-twilio-signature'] as string;

    if (!signature) {
        console.warn('⚠️ Missing Twilio signature');
        return res.status(403).json({ error: 'Missing Twilio signature' });
    }

    // Twilio signatures are usually calculated using the full URL and POST parameters
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const url = `${protocol}://${host}${req.originalUrl}`;

    const params = req.body;

    // Create signature following Twilio's logic
    // 1. Start with the URL
    // 2. Append all POST variables sorted alphabetically by key
    const data = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], url);

    const expectedSignature = crypto
        .createHmac('sha1', config.twilio.authToken)
        .update(Buffer.from(data, 'utf-8'))
        .digest('base64');

    if (signature !== expectedSignature) {
        console.warn('⚠️ Invalid Twilio signature');
        // In local development or testing, we might want to skip this if needed
        if (config.nodeEnv === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
            return next();
        }
        return res.status(403).json({ error: 'Invalid signature' });
    }

    next();
}
