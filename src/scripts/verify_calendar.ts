
import { db, initDatabase } from '../db/client';
import { GoogleCalendarService } from '../services/scheduling/google-calendar';
import { loadClientConfig } from '../models/client-config';
import { google } from 'googleapis';

async function main() {
    initDatabase();
    const clientId = 'abc';

    console.log(`Checking calendar for client: ${clientId}...`);

    const service = new GoogleCalendarService();
    try {
        // @ts-ignore - accessing private or protected method for debugging
        const { oauth2Client, calendarId } = await service.getAuthenticatedClient(clientId);
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);

        const res = await calendar.events.list({
            calendarId,
            timeMin: now.toISOString(),
            timeMax: nextWeek.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = res.data.items || [];
        console.log(`\nFound ${events.length} upcoming events:`);
        if (events.length === 0) {
            console.log('No events found.');
        } else {
            for (const event of events) {
                console.log(`- [${event.start?.dateTime || event.start?.date}] ${event.summary} (${event.status})`);
            }
        }

    } catch (error) {
        console.error('Failed to list events:', error);
    }
}

main();
