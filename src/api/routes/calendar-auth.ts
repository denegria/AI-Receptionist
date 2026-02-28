import { Router, Request, Response } from 'express';
import { GoogleCalendarService } from '../../services/scheduling/google-calendar';
import { OutlookCalendarService } from '../../services/scheduling/outlook-calendar';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { calendarCredentialsRepository, CalendarProvider } from '../../db/repositories/calendar-credentials-repository';

export const calendarAuthRouter = Router();

const googleService = new GoogleCalendarService();
const outlookService = new OutlookCalendarService();

function parseProvider(value: string): CalendarProvider | null {
    if (value === 'google' || value === 'outlook') return value;
    return null;
}

function validateClientId(clientId?: string): string | null {
    if (!clientId) return null;
    if (!clientRegistryRepository.findById(clientId)) return null;
    return clientId;
}

// Google OAuth
calendarAuthRouter.get('/auth/google/login', (req: Request, res: Response) => {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).send('Missing clientId');
    if (!clientRegistryRepository.findById(clientId)) return res.status(404).send('Unknown clientId');

    const url = googleService.getAuthUrl(clientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/google/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    const clientId = state as string;
    if (!clientRegistryRepository.findById(clientId)) {
        return res.status(404).send('Unknown clientId in OAuth state');
    }

    try {
        await googleService.handleCallback(clientId, code as string);
        res.send('Google Calendar connected successfully! You can close this window.');
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Outlook OAuth
calendarAuthRouter.get('/auth/microsoft/login', (req: Request, res: Response) => {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).send('Missing clientId');
    if (!clientRegistryRepository.findById(clientId)) return res.status(404).send('Unknown clientId');

    const url = outlookService.getAuthUrl(clientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/microsoft/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    const clientId = state as string;
    if (!clientRegistryRepository.findById(clientId)) {
        return res.status(404).send('Unknown clientId in OAuth state');
    }

    try {
        await outlookService.handleCallback(clientId, code as string);
        res.send('Outlook Calendar connected successfully! You can close this window.');
    } catch (error) {
        console.error('Microsoft Auth Error:', error);
        res.status(500).send('Authentication failed');
    }
});

calendarAuthRouter.get('/auth/:provider/status', (req: Request, res: Response) => {
    const rawProvider = req.params.provider;
    const provider = parseProvider(typeof rawProvider === 'string' ? rawProvider : '');
    if (!provider) return res.status(400).json({ error: 'Invalid provider' });

    const rawClientId = req.query.clientId;
    const clientId = validateClientId(typeof rawClientId === 'string' ? rawClientId : undefined);
    if (!clientId) return res.status(404).json({ error: 'Unknown clientId' });

    const creds = calendarCredentialsRepository.get(clientId, provider);
    return res.json({
        connected: Boolean(creds),
        calendarId: creds?.calendar_id || null,
        timezone: creds?.calendar_timezone || null,
    });
});

calendarAuthRouter.get('/auth/:provider/calendars', async (req: Request, res: Response) => {
    const rawProvider = req.params.provider;
    const provider = parseProvider(typeof rawProvider === 'string' ? rawProvider : '');
    if (!provider) return res.status(400).json({ error: 'Invalid provider' });

    const rawClientId = req.query.clientId;
    const clientId = validateClientId(typeof rawClientId === 'string' ? rawClientId : undefined);
    if (!clientId) return res.status(404).json({ error: 'Unknown clientId' });

    try {
        const calendars = provider === 'google'
            ? await googleService.listCalendars(clientId)
            : await outlookService.listCalendars(clientId);

        const creds = calendarCredentialsRepository.get(clientId, provider);
        return res.json({
            connected: true,
            selectedCalendarId: creds?.calendar_id || 'primary',
            calendars,
        });
    } catch (error: any) {
        return res.status(400).json({
            connected: false,
            error: error.message || 'Failed to fetch calendars',
        });
    }
});

calendarAuthRouter.post('/auth/:provider/select-calendar', (req: Request, res: Response) => {
    const rawProvider = req.params.provider;
    const provider = parseProvider(typeof rawProvider === 'string' ? rawProvider : '');
    if (!provider) {
        return res.status(400).json({ error: 'Invalid provider' });
    }

    const { clientId: rawClientId, calendarId: rawCalendarId, timezone } = req.body || {};
    const clientId = typeof rawClientId === 'string' ? rawClientId : '';
    const calendarId = typeof rawCalendarId === 'string' ? rawCalendarId : '';

    if (!clientId || !calendarId) {
        return res.status(400).json({ error: 'Missing clientId or calendarId' });
    }

    if (!validateClientId(clientId)) {
        return res.status(404).json({ error: 'Unknown clientId' });
    }

    try {
        calendarCredentialsRepository.setCalendarSelection(clientId, provider, calendarId, typeof timezone === 'string' ? timezone : null);
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(400).json({ error: error.message || 'Failed to set calendar selection' });
    }
});
