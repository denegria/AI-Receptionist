import { Router, Request, Response } from 'express';
import { GoogleCalendarService } from '../../services/scheduling/google-calendar';
import { OutlookCalendarService } from '../../services/scheduling/outlook-calendar';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { calendarCredentialsRepository, CalendarProvider } from '../../db/repositories/calendar-credentials-repository';

export const calendarAuthRouter = Router();

const googleService = new GoogleCalendarService();
const outlookService = new OutlookCalendarService();

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

calendarAuthRouter.post('/auth/:provider/select-calendar', (req: Request, res: Response) => {
    const provider = req.params.provider as CalendarProvider;
    if (provider !== 'google' && provider !== 'outlook') {
        return res.status(400).json({ error: 'Invalid provider' });
    }

    const { clientId, calendarId, timezone } = req.body || {};
    if (!clientId || !calendarId) {
        return res.status(400).json({ error: 'Missing clientId or calendarId' });
    }

    if (!clientRegistryRepository.findById(clientId)) {
        return res.status(404).json({ error: 'Unknown clientId' });
    }

    try {
        calendarCredentialsRepository.setCalendarSelection(clientId, provider, calendarId, timezone || null);
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(400).json({ error: error.message || 'Failed to set calendar selection' });
    }
});
