import { db } from '../client';

export interface CallLog {
    id?: number;
    client_id: string;
    call_sid: string;
    caller_phone: string;
    call_direction: 'inbound' | 'outbound';
    call_status: 'initiated' | 'in-progress' | 'completed' | 'failed' | 'no-answer';
    call_duration?: number;
    intent_detected?: string;
    conversation_summary?: string;
    error_message?: string;
    created_at?: string;
}

export class CallLogRepository {
    create(log: CallLog): number {
        const stmt = db.prepare(`
            INSERT INTO call_logs (
                client_id, call_sid, caller_phone, call_direction,
                call_status, intent_detected
            ) VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            log.client_id,
            log.call_sid,
            log.caller_phone,
            log.call_direction,
            log.call_status,
            log.intent_detected
        );

        return result.lastInsertRowid as number;
    }

    update(callSid: string, updates: Partial<CallLog>): void {
        const validFields = ['client_id', 'caller_phone', 'call_direction', 'call_status', 'call_duration', 'intent_detected', 'conversation_summary', 'error_message'];
        const fields = Object.keys(updates)
            .filter(k => validFields.includes(k))
            .map(k => `${k} = ?`)
            .join(', ');

        if (!fields) return;

        const values = Object.keys(updates)
            .filter(k => validFields.includes(k))
            .map(k => updates[k as keyof CallLog]);

        const stmt = db.prepare(
            `UPDATE call_logs SET ${fields} WHERE call_sid = ?`
        );

        stmt.run(...values, callSid);
    }

    findByCallSid(callSid: string): CallLog | null {
        const stmt = db.prepare(
            'SELECT * FROM call_logs WHERE call_sid = ?'
        );
        return stmt.get(callSid) as CallLog || null;
    }

    findByClient(clientId: string, limit: number = 50): CallLog[] {
        const stmt = db.prepare(`
            SELECT * FROM call_logs 
            WHERE client_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        `);
        return stmt.all(clientId, limit) as CallLog[];
    }
}

export const callLogRepository = new CallLogRepository();
