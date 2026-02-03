const { initDatabase } = require('./dist/db/client');
const { GoogleCalendarService } = require('./dist/services/scheduling/google-calendar');
const { google } = require('googleapis');

async function main() {
    initDatabase();
    const service = new GoogleCalendarService();
    console.log('Authenticating...');
    // accessing private method via bracket notation
    const auth = await service['getAuthenticatedClient']('abc');

    console.log('Listing events...');
    const calendar = google.calendar({ version: 'v3', auth });
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
    });

    console.log('EVENTS:', JSON.stringify(res.data.items, null, 2));
}

main().catch(console.error);
