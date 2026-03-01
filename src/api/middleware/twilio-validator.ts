import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import twilio from 'twilio';

export function validateTwilioRequest(req: Request, res: Response, next: NextFunction) {
    const preflightKey = req.headers['x-preflight-key'] as string | undefined;
    if (preflightKey && preflightKey === config.admin.apiKey) {
        return next();
    }

    const signature = req.headers['x-twilio-signature'] as string;

    if (!signature) {
        console.warn('⚠️ Missing Twilio signature');
        return res.status(403).json({ error: 'Missing Twilio signature' });
    }

    // Reconstruction of the URL that Twilio used to request this server
    // Proxies (like Ngrok or Fly.io) set X-Forwarded headers that we must use
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `${protocol}://${host}${req.originalUrl}`;

    const params = req.body || {};

    // Use Twilio's official validation utility
    const isValid = twilio.validateRequest(
        config.twilio.authToken,
        signature,
        url,
        params
    );

    if (!isValid) {
        console.warn('⚠️ Invalid Twilio signature', { url });

        // Development bypass
        if (config.nodeEnv === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
            console.log('🛡️ Skipping validation (DEV mode)');
            return next();
        }
        return res.status(403).json({ error: 'Invalid signature' });
    }

    next();
}
