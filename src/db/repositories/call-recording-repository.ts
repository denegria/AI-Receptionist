import { getClientDatabase } from '../client';

export type CallRecordingStatus = 'processing' | 'ready' | 'failed';
export type CallRecordingDirection = 'inbound' | 'outbound';

export interface CallRecordingRecord {
    id?: number;
    client_id: string;
    call_sid: string;
    recording_sid?: string | null;
    recording_url?: string | null;
    duration?: number | null;
    call_direction: CallRecordingDirection;
    caller_phone?: string | null;
    status: CallRecordingStatus;
    transcript?: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface CallRecordingListParams {
    from?: string;
    to?: string;
    limit?: number;
    page?: number;
}

function ensureSchema(clientId: string): void {
    const db = getClientDatabase(clientId);
    db.exec(`
        CREATE TABLE IF NOT EXISTS call_recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT NOT NULL,
            call_sid TEXT NOT NULL,
            recording_sid TEXT,
            recording_url TEXT,
            duration INTEGER,
            call_direction TEXT NOT NULL CHECK(call_direction IN ('inbound', 'outbound')),
            caller_phone TEXT,
            status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'failed')),
            transcript TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(client_id, call_sid),
            UNIQUE(client_id, recording_sid)
        );
        CREATE INDEX IF NOT EXISTS idx_call_recordings_client_created_at ON call_recordings(client_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_call_recordings_client_call_sid ON call_recordings(client_id, call_sid);
        CREATE INDEX IF NOT EXISTS idx_call_recordings_client_recording_sid ON call_recordings(client_id, recording_sid);
    `);
}

export class CallRecordingRepository {
    upsert(record: CallRecordingRecord): void {
        ensureSchema(record.client_id);
        const db = getClientDatabase(record.client_id);
        const stmt = db.prepare(`
            INSERT INTO call_recordings (
                client_id, call_sid, recording_sid, recording_url, duration,
                call_direction, caller_phone, status, transcript
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(client_id, call_sid) DO UPDATE SET
                recording_sid = COALESCE(excluded.recording_sid, call_recordings.recording_sid),
                recording_url = COALESCE(excluded.recording_url, call_recordings.recording_url),
                duration = COALESCE(excluded.duration, call_recordings.duration),
                call_direction = COALESCE(excluded.call_direction, call_recordings.call_direction),
                caller_phone = COALESCE(excluded.caller_phone, call_recordings.caller_phone),
                status = COALESCE(excluded.status, call_recordings.status),
                transcript = COALESCE(excluded.transcript, call_recordings.transcript),
                updated_at = CURRENT_TIMESTAMP
        `);

        stmt.run(
            record.client_id,
            record.call_sid,
            record.recording_sid ?? null,
            record.recording_url ?? null,
            record.duration ?? null,
            record.call_direction,
            record.caller_phone ?? null,
            record.status,
            record.transcript ?? null
        );
    }

    findPagedByClient(clientId: string, params: CallRecordingListParams = {}) {
        ensureSchema(clientId);
        const db = getClientDatabase(clientId);
        const nowIso = new Date().toISOString();
        const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const from = params.from ?? defaultFrom;
        const to = params.to ?? nowIso;
        const limit = Math.max(1, Math.min(100, params.limit ?? 25));
        const page = Math.max(1, params.page ?? 1);
        const offset = (page - 1) * limit;

        const where = `
            client_id = ?
            AND datetime(created_at) >= datetime(?)
            AND datetime(created_at) <= datetime(?)
        `;

        const items = db.prepare(`
            SELECT id, client_id, call_sid, recording_sid, recording_url, duration,
                   call_direction, caller_phone, status, transcript, created_at, updated_at
            FROM call_recordings
            WHERE ${where}
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ? OFFSET ?
        `).all(clientId, from, to, limit, offset) as CallRecordingRecord[];

        const total = (db.prepare(`
            SELECT COUNT(*) as total
            FROM call_recordings
            WHERE ${where}
        `).get(clientId, from, to) as { total: number } | undefined)?.total ?? 0;

        return {
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
            filters: { from, to },
        };
    }
}

export const callRecordingRepository = new CallRecordingRepository();
