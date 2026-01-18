import { Router } from 'express';
import { GoogleCalendarService } from '../../services/scheduling/google-calendar';
import { OutlookCalendarService } from '../../services/scheduling/outlook-calendar';

export const calendarAuthRouter = Router();

const googleService = new GoogleCalendarService();
const outlookService = new OutlookCalendarService();

// Google OAuth
calendarAuthRouter.get('/auth/google/login', (req, res) => {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).send('Missing clientId');

    const url = googleService.getAuthUrl(clientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    try {
        await googleService.handleCallback(state as string, code as string);
        res.send('Google Calendar connected successfully! You can close this window.');
    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Outlook OAuth
calendarAuthRouter.get('/auth/microsoft/login', (req, res) => {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).send('Missing clientId');

    const url = outlookService.getAuthUrl(clientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/microsoft/callback', async (req, res) => {
    const { code, state } = req.query; // state passed as clientId
    if (!code) return res.status(400).send('Missing code');

    // Note: Microsoft Graph validation might require state check if we passed it.
    // Our implementation uses state as clientId.

    try {
        await outlookService.handleCallback(state as string || 'unknown', code as string);
        res.send('Outlook Calendar connected successfully! You can close this window.');
    } catch (error) {
        console.error('Microsoft Auth Error:', error);
        res.status(500).send('Authentication failed');
    }
});
