import { db } from '../client';

export interface VoicemailRecord {
    id?: number;
    call_sid: string;
    client_id: string;
    recording_url?: string;
    transcription_text?: string;
    duration?: number;
    created_at?: string;
}

export class VoicemailRepository {
    create(record: VoicemailRecord): void {
        const stmt = db.prepare(`
            INSERT INTO voicemails (call_sid, client_id, recording_url, transcription_text, duration)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(record.call_sid, record.client_id, record.recording_url, record.transcription_text, record.duration);
    }

    updateByCallSid(callSid: string, updates: Partial<VoicemailRecord>): void {
        const validFields = ['recording_url', 'transcription_text', 'duration'];
        const fields = Object.keys(updates)
            .filter(k => validFields.includes(k))
            .map(k => `${k} = ?`)
            .join(', ');

        if (!fields) return;

        const values = Object.keys(updates)
            .filter(k => validFields.includes(k))
            .map(k => updates[k as keyof VoicemailRecord]);

        const stmt = db.prepare(`UPDATE voicemails SET ${fields} WHERE call_sid = ?`);
        stmt.run(...values, callSid);
    }

    findByClientId(clientId: string): VoicemailRecord[] {
        const stmt = db.prepare(`SELECT * FROM voicemails WHERE client_id = ? ORDER BY created_at DESC`);
        return stmt.all(clientId) as VoicemailRecord[];
    }
}

export const voicemailRepository = new VoicemailRepository();
