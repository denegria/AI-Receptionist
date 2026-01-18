import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config';
import { db } from '../../db/client';
import { CryptoUtils } from '../../utils/crypto';
import { ICalendarService, TimeSlot, CalendarEvent } from './interfaces';

export class GoogleCalendarService implements ICalendarService {
    private createOAuthClient(): OAuth2Client {
        return new google.auth.OAuth2(
            config.google.clientId,
            config.google.clientSecret,
            config.google.redirectUri
        );
    }

    getAuthUrl(clientId: string): string {
        const oauth2Client = this.createOAuthClient();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
            state: clientId, // Pass clientId as state to know who is authenticating
            prompt: 'consent' // Force refresh token
        });
    }

    async handleCallback(clientId: string, code: string): Promise<void> {
        const oauth2Client = this.createOAuthClient();
        const { tokens } = await oauth2Client.getToken(code);

        // Encrypt tokens before saving
        const encryptedRefresh = tokens.refresh_token ? CryptoUtils.encrypt(tokens.refresh_token) : null;
        const encryptedAccess = tokens.access_token ? CryptoUtils.encrypt(tokens.access_token) : null;

        const stmt = db.prepare(`
            INSERT INTO calendar_credentials (client_id, provider, refresh_token, access_token, token_expires_at)
            VALUES (?, 'google', ?, ?, ?)
            ON CONFLICT(client_id) DO UPDATE SET
                refresh_token = COALESCE(excluded.refresh_token, refresh_token),
                access_token = excluded.access_token,
                token_expires_at = excluded.token_expires_at,
                updated_at = CURRENT_TIMESTAMP
        `);

        stmt.run(clientId, encryptedRefresh, encryptedAccess, tokens.expiry_date);
    }

    private async getAuthenticatedClient(clientId: string): Promise<OAuth2Client> {
        const stmt = db.prepare('SELECT refresh_token, access_token, token_expires_at FROM calendar_credentials WHERE client_id = ? AND provider = ?');
        const creds = stmt.get(clientId, 'google') as any;

        if (!creds) {
            throw new Error(`No Google credentials found for client ${clientId}`);
        }

        // Decrypt tokens
        const refreshToken = creds.refresh_token ? CryptoUtils.decrypt(creds.refresh_token) : undefined;
        const accessToken = creds.access_token ? CryptoUtils.decrypt(creds.access_token) : undefined;

        const oauth2Client = this.createOAuthClient();
        oauth2Client.setCredentials({
            refresh_token: refreshToken,
            access_token: accessToken,
            expiry_date: creds.token_expires_at
        });

        // Handle auto-refresh updates
        oauth2Client.on('tokens', (tokens) => {
            if (tokens.refresh_token || tokens.access_token) {
                const encRef = tokens.refresh_token ? CryptoUtils.encrypt(tokens.refresh_token) : null;
                const encAcc = tokens.access_token ? CryptoUtils.encrypt(tokens.access_token) : null;

                db.prepare(`
                    UPDATE calendar_credentials 
                    SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?
                    WHERE client_id = ? AND provider = 'google'
                `).run(encAcc, encRef, tokens.expiry_date, clientId);
            }
        });

        return oauth2Client;
    }

    async getBusyTimes(clientId: string, start: string, end: string): Promise<TimeSlot[]> {
        const auth = await this.getAuthenticatedClient(clientId);
        const calendar = google.calendar({ version: 'v3', auth });

        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: start,
                timeMax: end,
                items: [{ id: 'primary' }]
            }
        });

        const busy = response.data.calendars?.['primary']?.busy || [];

        return busy.map(b => ({
            start: b.start!,
            end: b.end!,
            available: false
        }));
    }

    async createEvent(clientId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const auth = await this.getAuthenticatedClient(clientId);
        const calendar = google.calendar({ version: 'v3', auth });

        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: {
                summary: event.summary,
                description: event.description,
                start: { dateTime: event.start },
                end: { dateTime: event.end },
            }
        });

        const data = response.data;

        return {
            id: data.id!,
            summary: data.summary!,
            start: data.start?.dateTime!,
            end: data.end?.dateTime!
        };
    }
}
