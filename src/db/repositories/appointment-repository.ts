import { getClientDatabase } from '../client';

export interface Appointment {
    id?: number;
    client_id: string;
    calendar_event_id: string;
    provider: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    service_type?: string;
    appointment_datetime: string;
    end_datetime: string;
    duration_minutes: number;
    status: 'confirmed' | 'cancelled' | 'completed' | 'no-show';
    synced_at?: string;
    created_at?: string;
}

export class AppointmentRepository {
    save(appt: Appointment): void {
        const db = getClientDatabase(appt.client_id);
        const stmt = db.prepare(`
            INSERT INTO appointment_cache (
                client_id, calendar_event_id, provider, customer_name,
                customer_phone, customer_email, service_type,
                appointment_datetime, end_datetime, duration_minutes, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client_id, calendar_event_id) DO UPDATE SET
                status = excluded.status,
                appointment_datetime = excluded.appointment_datetime,
                end_datetime = excluded.end_datetime,
                synced_at = CURRENT_TIMESTAMP
        `);

        stmt.run(
            appt.client_id,
            appt.calendar_event_id,
            appt.provider,
            appt.customer_name,
            appt.customer_phone,
            appt.customer_email,
            appt.service_type,
            appt.appointment_datetime,
            appt.end_datetime,
            appt.duration_minutes,
            appt.status
        );
    }

    findByClient(clientId: string, start?: string, end?: string): Appointment[] {
        const db = getClientDatabase(clientId);
        let query = 'SELECT * FROM appointment_cache WHERE client_id = ?';
        const params: any[] = [clientId];

        if (start) {
            query += ' AND appointment_datetime >= ?';
            params.push(start);
        }
        if (end) {
            query += ' AND appointment_datetime <= ?';
            params.push(end);
        }

        const stmt = db.prepare(query);
        return stmt.all(...params) as Appointment[];
    }

    updateStatus(clientId: string, eventId: string, status: Appointment['status']): void {
        const db = getClientDatabase(clientId);
        const stmt = db.prepare(`
            UPDATE appointment_cache 
            SET status = ?, synced_at = CURRENT_TIMESTAMP 
            WHERE client_id = ? AND calendar_event_id = ?
        `);
        stmt.run(status, clientId, eventId);
    }
}

export const appointmentRepository = new AppointmentRepository();
