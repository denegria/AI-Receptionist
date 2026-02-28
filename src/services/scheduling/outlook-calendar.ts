import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch'; // Polyfill for graph client
import { config } from '../../config';
import { db } from '../../db/client';
import { calendarCredentialsRepository } from '../../db/repositories/calendar-credentials-repository';
import { CryptoUtils } from '../../utils/crypto';
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

        // Calculate expiry
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

        // Encrypt tokens
        const encRef = tokens.refresh_token ? CryptoUtils.encrypt(tokens.refresh_token) : null;
        const encAcc = tokens.access_token ? CryptoUtils.encrypt(tokens.access_token) : null;

        calendarCredentialsRepository.upsert({
            clientId,
            provider: 'outlook',
            refreshToken: encRef,
            accessToken: encAcc,
            tokenExpiresAt: expiryDate.getTime(),
            calendarId: 'primary',
        });
    }

    private async getAuthenticatedClient(clientId: string): Promise<{ graphClient: Client; calendarId: string }> {
        const creds = calendarCredentialsRepository.get(clientId, 'outlook') as any;

        if (!creds) {
            throw new Error(`No Outlook credentials found for client ${clientId}`);
        }

        // Decrypt tokens
        const refreshToken = creds.refresh_token ? CryptoUtils.decrypt(creds.refresh_token) : '';
        let accessToken = creds.access_token ? CryptoUtils.decrypt(creds.access_token) : '';

        // Check expiry and refresh if needed
        if (creds.token_expires_at < Date.now()) {
            accessToken = await this.refreshAccessToken(clientId, refreshToken);
        }

        const graphClient = Client.init({
            authProvider: (done) => {
                done(null, accessToken);
            }
        });

        return { graphClient, calendarId: creds.calendar_id || 'primary' };
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

        // Encrypt new tokens
        const encRef = tokens.refresh_token ? CryptoUtils.encrypt(tokens.refresh_token) : null;
        const encAcc = CryptoUtils.encrypt(tokens.access_token);

        const stmt = db.prepare(`
            UPDATE calendar_credentials 
            SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE client_id = ? AND provider = 'outlook'
        `);

        stmt.run(encAcc, encRef, expiryDate.getTime(), clientId);

        return tokens.access_token;
    }

    async getBusyTimes(clientId: string, start: string, end: string): Promise<TimeSlot[]> {
        const { graphClient, calendarId } = await this.getAuthenticatedClient(clientId);

        const calendarViewPath = calendarId === 'primary'
            ? '/me/calendarView'
            : `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;

        const eventsResponse = await graphClient.api(calendarViewPath)
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
        const { graphClient, calendarId } = await this.getAuthenticatedClient(clientId);

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

        const eventsPath = calendarId === 'primary'
            ? '/me/events'
            : `/me/calendars/${encodeURIComponent(calendarId)}/events`;

        const res = await graphClient.api(eventsPath).post(newEvent);

        return {
            id: res.id,
            summary: res.subject,
            start: res.start.dateTime,
            end: res.end.dateTime
        };
    }
}
