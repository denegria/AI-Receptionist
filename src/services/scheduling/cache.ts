import { db } from '../../db/client';
import { CalendarEvent } from './interfaces';

export class CacheService {
    async saveAppointment(clientId: string, eventId: string, event: Partial<CalendarEvent>, provider: string) {
        const stmt = db.prepare(`
      INSERT INTO appointment_cache 
      (client_id, calendar_event_id, provider, appointment_datetime, end_datetime, duration_minutes, status, customer_name)
      VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?)
      ON CONFLICT(client_id, calendar_event_id) DO UPDATE SET
        appointment_datetime = excluded.appointment_datetime,
        end_datetime = excluded.end_datetime,
        synced_at = CURRENT_TIMESTAMP
    `);

        const duration = (new Date(event.end!).getTime() - new Date(event.start!).getTime()) / 60000;

        stmt.run(
            clientId,
            eventId,
            provider,
            event.start,
            event.end,
            duration,
            event.summary || 'Appt'
        );
    }

    async removeAppointment(clientId: string, eventId: string) {
        const stmt = db.prepare('DELETE FROM appointment_cache WHERE client_id = ? AND calendar_event_id = ?');
        stmt.run(clientId, eventId);
    }

    // Method to check local cache availability if needed
    async getCachedEvents(clientId: string, start: string, end: string) {
        const stmt = db.prepare(`
        SELECT * FROM appointment_cache 
        WHERE client_id = ? 
        AND appointment_datetime >= ? 
        AND appointment_datetime < ?
      `);
        return stmt.all(clientId, start, end);
    }
}
