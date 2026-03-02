import { Router, Request, Response } from 'express';
import { GoogleCalendarService } from '../../services/scheduling/google-calendar';
import { OutlookCalendarService } from '../../services/scheduling/outlook-calendar';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { calendarCredentialsRepository, CalendarProvider } from '../../db/repositories/calendar-credentials-repository';
import { ClientConfig } from '../../models/client-config';

export const calendarAuthRouter = Router();

const googleService = new GoogleCalendarService();
const outlookService = new OutlookCalendarService();

function parseProvider(value: string): CalendarProvider | null {
    if (value === 'google' || value === 'outlook') return value;
    return null;
}

function ensureClientRegistration(clientId?: string): string | null {
    if (!clientId) return null;
    if (clientRegistryRepository.findById(clientId)) return clientId;

    const pendingConfig: ClientConfig = {
        clientId,
        businessName: 'Pending Setup',
        phoneNumber: `pending-${clientId}`,
        timezone: 'UTC',
        businessHours: {
            monday: { start: '09:00', end: '17:00', enabled: true },
            tuesday: { start: '09:00', end: '17:00', enabled: true },
            wednesday: { start: '09:00', end: '17:00', enabled: true },
            thursday: { start: '09:00', end: '17:00', enabled: true },
            friday: { start: '09:00', end: '17:00', enabled: true },
            saturday: { start: '09:00', end: '12:00', enabled: false },
            sunday: { start: '09:00', end: '12:00', enabled: false },
        },
        holidays: [],
        appointmentTypes: [{ name: 'General Inquiry', duration: 30, bufferBefore: 0, bufferAfter: 0 }],
        calendar: {
            provider: 'google',
            calendarId: 'primary',
            syncEnabled: false,
            createMeetLinks: false,
        },
        routing: {
            afterHoursAction: 'voicemail',
            fallbackNumber: '',
            voicemailEnabled: true,
        },
        notifications: {},
        aiSettings: {
            greeting: 'Hi, thank you for calling. How can I help you today?',
            maxRetries: 3,
            requireServiceType: false,
        },
    };

    clientRegistryRepository.register(pendingConfig);
    clientRegistryRepository.updateStatus(clientId, 'trial');
    return clientId;
}

// Google OAuth
calendarAuthRouter.get('/auth/google/login', (req: Request, res: Response) => {
    const clientId = req.query.clientId as string;
    const registeredClientId = ensureClientRegistration(clientId);
    if (!registeredClientId) return res.status(400).send('Missing clientId');

    const url = googleService.getAuthUrl(registeredClientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/google/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    const clientId = ensureClientRegistration(state as string);
    if (!clientId) return res.status(400).send('Missing clientId in OAuth state');

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
    const registeredClientId = ensureClientRegistration(clientId);
    if (!registeredClientId) return res.status(400).send('Missing clientId');

    const url = outlookService.getAuthUrl(registeredClientId);
    res.redirect(url);
});

calendarAuthRouter.get('/auth/microsoft/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send('Missing code or state');

    const clientId = ensureClientRegistration(state as string);
    if (!clientId) return res.status(400).send('Missing clientId in OAuth state');

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
    const clientId = ensureClientRegistration(typeof rawClientId === 'string' ? rawClientId : undefined);
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
    const clientId = ensureClientRegistration(typeof rawClientId === 'string' ? rawClientId : undefined);
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

    if (!ensureClientRegistration(clientId)) {
        return res.status(404).json({ error: 'Unknown clientId' });
    }

    try {
        calendarCredentialsRepository.setCalendarSelection(clientId, provider, calendarId, typeof timezone === 'string' ? timezone : null);
        return res.json({ success: true });
    } catch (error: any) {
        return res.status(400).json({ error: error.message || 'Failed to set calendar selection' });
    }
});

calendarAuthRouter.get('/calendar/settings', async (req: Request, res: Response) => {
    const rawClientId = req.query.clientId;
    const clientId = ensureClientRegistration(typeof rawClientId === 'string' ? rawClientId : undefined);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    const credentials = calendarCredentialsRepository.listByClient(clientId);
    const connectedByProvider = new Map(credentials.map((c) => [c.provider, c]));

    const providers: CalendarProvider[] = ['google', 'outlook'];

    const accounts = await Promise.all(providers.map(async (provider) => {
        const cred = connectedByProvider.get(provider) || null;
        const isExpired = Boolean(cred?.token_expires_at && Number(cred.token_expires_at) > 0 && Number(cred.token_expires_at) < Date.now());

        let calendars: Array<{ id: string; name: string }> = [];
        if (cred) {
            try {
                const rows = provider === 'google'
                    ? await googleService.listCalendars(clientId)
                    : await outlookService.listCalendars(clientId);
                calendars = rows.map((r: any) => ({ id: r.id, name: r.name || r.id }));
            } catch {
                calendars = [];
            }
        }

        return {
            id: `${provider}-${cred?.id || 'default'}`,
            provider,
            label: provider === 'google' ? 'Google Calendar' : 'Outlook Calendar',
            email: cred?.account_email || '',
            status: cred ? (isExpired ? 'expired' : 'connected') : 'disconnected',
            calendars,
        };
    }));

    const connected = accounts.find((a) => a.status !== 'disconnected') || accounts[0];
    const selectedCalendarId = connected?.calendars.find((c) => c.id === (connectedByProvider.get(connected.provider)?.calendar_id || ''))?.id
        || connected?.calendars[0]?.id
        || '';

    return res.json({
        accounts,
        selectedAccountId: connected?.id || '',
        selectedCalendarId,
        selectedCalendarIds: selectedCalendarId ? [selectedCalendarId] : [],
    });
});

calendarAuthRouter.put('/calendar/settings', (req: Request, res: Response) => {
    const { clientId: rawClientId, selectedAccountId, selectedCalendarId, selectedCalendarIds } = req.body || {};
    const clientId = ensureClientRegistration(typeof rawClientId === 'string' ? rawClientId : undefined);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    const accountId = typeof selectedAccountId === 'string' ? selectedAccountId : '';
    const calendarIds = Array.isArray(selectedCalendarIds)
        ? selectedCalendarIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
        : typeof selectedCalendarId === 'string' && selectedCalendarId.trim().length > 0
            ? [selectedCalendarId]
            : [];

    const provider = accountId.startsWith('google-') ? 'google' : accountId.startsWith('outlook-') ? 'outlook' : null;
    if (!provider) return res.status(400).json({ error: 'Invalid selectedAccountId' });
    if (!calendarIds.length) return res.status(400).json({ error: 'Missing selectedCalendarIds' });

    try {
        calendarCredentialsRepository.setCalendarSelection(clientId, provider, calendarIds[0]);
        return res.json({ success: true, selectedCalendarIds: calendarIds });
    } catch (error: any) {
        return res.status(400).json({ error: error.message || 'Failed to save calendar selection' });
    }
});

calendarAuthRouter.post('/calendar/actions', (req: Request, res: Response) => {
    const { clientId: rawClientId, action, accountId } = req.body || {};
    const clientId = ensureClientRegistration(typeof rawClientId === 'string' ? rawClientId : undefined);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    const actionValue = typeof action === 'string' ? action : '';
    if (!['connect', 'reconnect', 'disconnect'].includes(actionValue)) {
        return res.status(400).json({ error: 'Invalid action' });
    }

    const inferredProvider = typeof accountId === 'string' && accountId.startsWith('outlook-') ? 'outlook' : 'google';

    if (actionValue === 'disconnect') {
        calendarCredentialsRepository.disconnect(clientId, inferredProvider);
        return res.json({ success: true });
    }

    const authUrl = inferredProvider === 'google'
        ? googleService.getAuthUrl(clientId)
        : outlookService.getAuthUrl(clientId);

    return res.json({ success: true, authUrl, provider: inferredProvider });
});
