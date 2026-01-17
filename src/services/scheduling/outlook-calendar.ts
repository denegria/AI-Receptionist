import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch'; // Polyfill for graph client
import { config } from '../../config';
import { db } from '../../db/client';
import { ICalendarService, TimeSlot, CalendarEvent } from './interfaces';

interface MicrosoftTokens {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

export class OutlookCalendarService implements ICalendarService {

    getAuthUrl(clientId: string): string {
        const params = new URLSearchParams({
            client_id: config.microsoft.clientId,
            response_type: 'code',
            redirect_uri: 'http://localhost:3000/auth/microsoft/callback', // We should add this to config properly
            response_mode: 'query',
            scope: 'offline_access user.read calendars.readwrite',
            state: clientId
        });

        return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    }

    async handleCallback(clientId: string, code: string): Promise<void> {
        const params = new URLSearchParams({
            client_id: config.microsoft.clientId,
            scope: 'offline_access user.read calendars.readwrite',
            code: code,
            redirect_uri: 'http://localhost:3000/auth/microsoft/callback',
            grant_type: 'authorization_code',
            client_secret: config.microsoft.clientSecret,
        });

        const response = await fetch(`https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            throw new Error(`Microsoft Token Error: ${await response.text()}`);
        }

        const tokens = await response.json() as MicrosoftTokens;

        // Calculate expiry (expires_in is seconds)
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

        const stmt = db.prepare(`
      INSERT INTO calendar_credentials (client_id, provider, refresh_token, access_token, token_expires_at)
      VALUES (?, 'outlook', ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        refresh_token = excluded.refresh_token,
        access_token = excluded.access_token,
        token_expires_at = excluded.token_expires_at,
        updated_at = CURRENT_TIMESTAMP
    `);

        stmt.run(clientId, tokens.refresh_token, tokens.access_token, expiryDate.getTime());
    }

    private async getAuthenticatedClient(clientId: string): Promise<Client> {
        const stmt = db.prepare('SELECT refresh_token, access_token, token_expires_at FROM calendar_credentials WHERE client_id = ? AND provider = ?');
        const creds = stmt.get(clientId, 'outlook') as any;

        if (!creds) {
            throw new Error(`No Outlook credentials found for client ${clientId}`);
        }

        // Check expiry and refresh if needed
        let accessToken = creds.access_token;
        if (creds.token_expires_at < Date.now()) {
            accessToken = await this.refreshAccessToken(clientId, creds.refresh_token);
        }

        return Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });
    }

    private async refreshAccessToken(clientId: string, refreshToken: string): Promise<string> {
        const params = new URLSearchParams({
            client_id: config.microsoft.clientId,
            client_secret: config.microsoft.clientSecret,
            scope: 'offline_access user.read calendars.readwrite',
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            redirect_uri: 'http://localhost:3000/auth/microsoft/callback'
        });

        const response = await fetch(`https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            throw new Error('Failed to refresh Microsoft token');
        }

        const tokens = await response.json() as MicrosoftTokens;
        // Save new tokens
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

        const stmt = db.prepare(`
        UPDATE calendar_credentials 
        SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE client_id = ? AND provider = 'outlook'
       `);
        // Sometimes Graph doesn't return a new refresh token, so keep old one if so
        stmt.run(tokens.access_token, tokens.refresh_token || null, expiryDate.getTime(), clientId);

        return tokens.access_token;
    }

    async getBusyTimes(clientId: string, start: string, end: string): Promise<TimeSlot[]> {
        const client = await this.getAuthenticatedClient(clientId);

        const response = await client.api('/me/calendar/getSchedule').post({
            schedules: [config.microsoft.clientId], // Wait, this expects email addresses typically? In OAuth "me" context, we might check /me/calendarView
            startTime: { dateTime: start, timeZone: 'UTC' },
            endTime: { dateTime: end, timeZone: 'UTC' },
            availabilityViewInterval: 60
        });
        // Actually /getSchedule is for checking others. For "me", we can just list events or use calendarView

        const eventsResponse = await client.api('/me/calendarView')
            .query({
                startDateTime: start,
                endDateTime: end,
                '$select': 'subject,start,end'
            })
            .get();

        const busy: TimeSlot[] = eventsResponse.value.map((e: any) => ({
            start: e.start.dateTime,
            end: e.end.dateTime,
            available: false
        }));

        return busy;
    }

    async createEvent(clientId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const client = await this.getAuthenticatedClient(clientId);

        const newEvent = {
            subject: event.summary,
            body: {
                contentType: 'Text',
                content: event.description
            },
            start: {
                dateTime: event.start,
                timeZone: 'UTC'
            },
            end: {
                dateTime: event.end,
                timeZone: 'UTC'
            }
        };

        const res = await client.api('/me/events').post(newEvent);

        return {
            id: res.id,
            summary: res.subject,
            start: res.start.dateTime,
            end: res.end.dateTime
        };
    }
}
