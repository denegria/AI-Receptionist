import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config';
import { db } from '../../db/client';
import { calendarCredentialsRepository } from '../../db/repositories/calendar-credentials-repository';
import { CryptoUtils } from '../../utils/crypto';
import { ICalendarService, TimeSlot, CalendarEvent } from './interfaces';

interface GoogleCalendarSummary {
    id: string;
    name: string;
    timezone?: string;
    primary?: boolean;
}

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

        calendarCredentialsRepository.upsert({
            clientId,
            provider: 'google',
            refreshToken: encryptedRefresh,
            accessToken: encryptedAccess,
            tokenExpiresAt: tokens.expiry_date ?? null,
            calendarId: 'primary',
        });
    }

    private async getAuthenticatedClient(clientId: string): Promise<{ oauth2Client: OAuth2Client; calendarId: string }> {
        const creds = calendarCredentialsRepository.get(clientId, 'google') as any;

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

        return { oauth2Client, calendarId: creds.calendar_id || 'primary' };
    }

    async getBusyTimes(clientId: string, start: string, end: string): Promise<TimeSlot[]> {
        try {
            const { oauth2Client, calendarId } = await this.getAuthenticatedClient(clientId);
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            const response = await calendar.freebusy.query({
                requestBody: {
                    timeMin: start,
                    timeMax: end,
                    items: [{ id: calendarId }]
                }
            });

            const busy = response.data.calendars?.[calendarId]?.busy || [];

            return busy.map(b => ({
                start: b.start!,
                end: b.end!,
                available: false
            }));
        } catch (error: any) {
            console.error('Google Calendar API Error:', error);

            // Check for specific error types
            if (error.code === 401) {
                throw new Error('Calendar authentication expired. Please reconnect.');
            } else if (error.code === 403) {
                throw new Error('Insufficient calendar permissions.');
            } else if (error.code === 404) {
                throw new Error('Calendar not found.');
            }

            throw new Error(`Calendar API error: ${error.message}`);
        }
    }

    async listCalendars(clientId: string): Promise<GoogleCalendarSummary[]> {
        const { oauth2Client } = await this.getAuthenticatedClient(clientId);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        const response = await calendar.calendarList.list();
        const items = response.data.items || [];

        return items
            .filter((c) => Boolean(c.id))
            .map((c) => ({
                id: c.id!,
                name: c.summary || c.id!,
                timezone: c.timeZone || undefined,
                primary: Boolean(c.primary),
            }));
    }

    async createEvent(clientId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const { oauth2Client, calendarId } = await this.getAuthenticatedClient(clientId);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const response = await calendar.events.insert({
            calendarId,
            requestBody: {
                summary: event.summary,
                description: event.description,
                start: { dateTime: event.start },
                end: { dateTime: event.end },
                attendees: event.attendees
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
