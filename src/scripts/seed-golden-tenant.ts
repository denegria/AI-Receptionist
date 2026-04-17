import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { getClientDatabase } from '../db/client';
import { sharedDb } from '../db/shared-client';
import { clientRegistryRepository } from '../db/repositories/client-registry-repository';

type SeedCall = {
    callSid: string;
    createdAt: string;
    callerPhone: string;
    direction: 'inbound' | 'outbound';
    status: 'completed' | 'missed' | 'failed';
    durationSeconds: number;
    intent: string | null;
    summary: string;
    turns?: Array<{ role: 'user' | 'assistant'; content: string }>;
    recording?: {
        recordingSid: string;
        recordingUrl: string;
        transcript: string;
        status: 'ready' | 'failed' | 'processing';
    };
    voicemail?: {
        recordingUrl: string;
        durationSeconds: number;
        transcript: string | null;
    };
};

type SeedAppointment = {
    eventId: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    serviceType: string;
    appointmentAt: string;
    endAt: string;
    durationMinutes: number;
    status: 'confirmed' | 'cancelled' | 'completed' | 'no-show';
};

function arg(name: string, fallback?: string): string | undefined {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

function toIsoRelative(daysFromNow: number, hourUtc: number, minuteUtc: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysFromNow);
    d.setUTCHours(hourUtc, minuteUtc, 0, 0);
    return d.toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
    return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function ensureCallRecordingSchema(clientId: string): void {
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

function ensureCalendarSyncRunsTable(): void {
    sharedDb.exec(`
        CREATE TABLE IF NOT EXISTS calendar_sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT NOT NULL,
            synced_count INTEGER DEFAULT 0,
            error TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT
        )
    `);
}

function buildSeedCalls(seedTag: string): SeedCall[] {
    return [
        {
            callSid: `${seedTag}-call-001`,
            createdAt: toIsoRelative(-9, 14, 15),
            callerPhone: '+17185550101',
            direction: 'inbound',
            status: 'completed',
            durationSeconds: 412,
            intent: 'emergency_leak',
            summary: 'Caller reported a kitchen pipe leak and accepted the earliest same-day slot.',
            turns: [
                { role: 'user', content: 'My kitchen sink pipe is leaking and water is pooling under the cabinet.' },
                { role: 'assistant', content: 'I can help with that. Let me grab your address and see the earliest available emergency slot.' },
                { role: 'user', content: 'I am in Hoboken and need someone today if possible.' },
                { role: 'assistant', content: 'Booked for this afternoon and marked as an emergency leak visit.' },
            ],
            recording: {
                recordingSid: `${seedTag}-recording-001`,
                recordingUrl: 'https://example.com/recordings/golden-call-001.mp3',
                transcript: 'Caller reported a kitchen leak in Hoboken and booked a same-day emergency visit.',
                status: 'ready',
            },
        },
        {
            callSid: `${seedTag}-call-002`,
            createdAt: toIsoRelative(-8, 16, 40),
            callerPhone: '+17185550102',
            direction: 'inbound',
            status: 'completed',
            durationSeconds: 355,
            intent: 'water_heater_quote',
            summary: 'Caller asked for a water heater replacement quote and requested a consult next week.',
            turns: [
                { role: 'user', content: 'I think my water heater is done. I need a replacement estimate.' },
                { role: 'assistant', content: 'Understood. I can book a consult and note the unit age for the technician.' },
            ],
            recording: {
                recordingSid: `${seedTag}-recording-002`,
                recordingUrl: 'https://example.com/recordings/golden-call-002.mp3',
                transcript: 'Customer requested a replacement quote for an aging water heater and booked a consult.',
                status: 'ready',
            },
        },
        {
            callSid: `${seedTag}-call-003`,
            createdAt: toIsoRelative(-7, 11, 10),
            callerPhone: '+17185550103',
            direction: 'inbound',
            status: 'missed',
            durationSeconds: 0,
            intent: null,
            summary: 'Missed first-time caller asking about drain cleaning.',
            voicemail: {
                recordingUrl: 'https://example.com/voicemails/golden-voicemail-003.mp3',
                durationSeconds: 48,
                transcript: 'Hi, my shower drain is backing up. Please call me back this afternoon.',
            },
        },
        {
            callSid: `${seedTag}-call-004`,
            createdAt: toIsoRelative(-6, 13, 5),
            callerPhone: '+17185550104',
            direction: 'inbound',
            status: 'completed',
            durationSeconds: 289,
            intent: 'toilet_repair',
            summary: 'Caller booked a standard toilet repair visit for tomorrow morning.',
            turns: [
                { role: 'user', content: 'Our downstairs toilet keeps running and sometimes overflows.' },
                { role: 'assistant', content: 'I have an opening tomorrow morning. I can lock that in for you now.' },
            ],
            recording: {
                recordingSid: `${seedTag}-recording-004`,
                recordingUrl: 'https://example.com/recordings/golden-call-004.mp3',
                transcript: 'Customer described an overflowing toilet and booked a morning repair window.',
                status: 'ready',
            },
        },
        {
            callSid: `${seedTag}-call-005`,
            createdAt: toIsoRelative(-5, 9, 25),
            callerPhone: '+17185550105',
            direction: 'inbound',
            status: 'failed',
            durationSeconds: 0,
            intent: null,
            summary: 'Call dropped before qualification after caller mentioned no hot water.',
        },
        {
            callSid: `${seedTag}-call-006`,
            createdAt: toIsoRelative(-4, 18, 2),
            callerPhone: '+17185550106',
            direction: 'inbound',
            status: 'missed',
            durationSeconds: 0,
            intent: null,
            summary: 'After-hours missed call about sewer odor concern.',
            voicemail: {
                recordingUrl: 'https://example.com/voicemails/golden-voicemail-006.mp3',
                durationSeconds: 31,
                transcript: 'We smell sewer gas in the basement and want someone to inspect it tomorrow.',
            },
        },
        {
            callSid: `${seedTag}-call-007`,
            createdAt: toIsoRelative(-3, 15, 30),
            callerPhone: '+17185550107',
            direction: 'inbound',
            status: 'completed',
            durationSeconds: 501,
            intent: 'commercial_plumbing_quote',
            summary: 'Small restaurant owner requested a commercial grease trap and line inspection quote.',
            turns: [
                { role: 'user', content: 'I need a quote for grease trap service and a line inspection at our restaurant.' },
                { role: 'assistant', content: 'I can schedule a commercial estimate visit and note the urgency for the operations team.' },
            ],
            recording: {
                recordingSid: `${seedTag}-recording-007`,
                recordingUrl: 'https://example.com/recordings/golden-call-007.mp3',
                transcript: 'Restaurant owner requested a commercial estimate for grease trap service and inspection.',
                status: 'ready',
            },
        },
        {
            callSid: `${seedTag}-call-008`,
            createdAt: toIsoRelative(-2, 10, 45),
            callerPhone: '+17185550108',
            direction: 'outbound',
            status: 'completed',
            durationSeconds: 182,
            intent: 'follow_up',
            summary: 'Outbound follow-up confirming tomorrow appointment window and parking instructions.',
        },
        {
            callSid: `${seedTag}-call-009`,
            createdAt: toIsoRelative(-1, 12, 5),
            callerPhone: '+17185550109',
            direction: 'inbound',
            status: 'missed',
            durationSeconds: 0,
            intent: null,
            summary: 'Missed landlord inquiry about a leak behind a bathroom wall.',
            voicemail: {
                recordingUrl: 'https://example.com/voicemails/golden-voicemail-009.mp3',
                durationSeconds: 42,
                transcript: null,
            },
        },
        {
            callSid: `${seedTag}-call-010`,
            createdAt: toIsoRelative(0, 8, 50),
            callerPhone: '+17185550110',
            direction: 'inbound',
            status: 'completed',
            durationSeconds: 267,
            intent: 'drain_cleaning',
            summary: 'Caller booked a drain cleaning visit for later this week.',
            turns: [
                { role: 'user', content: 'My main line is draining slowly and we need someone this week.' },
                { role: 'assistant', content: 'I have a Thursday afternoon opening and I can book that for a drain cleaning.' },
            ],
        },
    ];
}

function buildSeedAppointments(seedTag: string): SeedAppointment[] {
    const completedAt = toIsoRelative(-8, 18, 0);
    const cancelledAt = toIsoRelative(-2, 19, 30);
    const noShowAt = toIsoRelative(-1, 14, 0);
    const upcomingOne = toIsoRelative(2, 15, 0);
    const upcomingTwo = toIsoRelative(4, 13, 30);

    return [
        {
            eventId: `${seedTag}-event-001`,
            customerName: 'Maya Thompson',
            customerPhone: '+17185550101',
            customerEmail: 'maya.thompson@example.com',
            serviceType: 'Emergency leak repair',
            appointmentAt: completedAt,
            endAt: plusMinutes(completedAt, 90),
            durationMinutes: 90,
            status: 'completed',
        },
        {
            eventId: `${seedTag}-event-002`,
            customerName: 'Daniel Ortiz',
            customerPhone: '+17185550102',
            customerEmail: 'daniel.ortiz@example.com',
            serviceType: 'Water heater replacement consult',
            appointmentAt: upcomingOne,
            endAt: plusMinutes(upcomingOne, 60),
            durationMinutes: 60,
            status: 'confirmed',
        },
        {
            eventId: `${seedTag}-event-003`,
            customerName: 'Priya Shah',
            customerPhone: '+17185550104',
            customerEmail: 'priya.shah@example.com',
            serviceType: 'Toilet repair',
            appointmentAt: upcomingTwo,
            endAt: plusMinutes(upcomingTwo, 60),
            durationMinutes: 60,
            status: 'confirmed',
        },
        {
            eventId: `${seedTag}-event-004`,
            customerName: 'Nina Alvarez',
            customerPhone: '+17185550107',
            customerEmail: 'nina.alvarez@example.com',
            serviceType: 'Commercial plumbing estimate',
            appointmentAt: cancelledAt,
            endAt: plusMinutes(cancelledAt, 45),
            durationMinutes: 45,
            status: 'cancelled',
        },
        {
            eventId: `${seedTag}-event-005`,
            customerName: 'Owen Brooks',
            customerPhone: '+17185550110',
            customerEmail: 'owen.brooks@example.com',
            serviceType: 'Drain cleaning',
            appointmentAt: noShowAt,
            endAt: plusMinutes(noShowAt, 45),
            durationMinutes: 45,
            status: 'no-show',
        },
    ];
}

function main() {
    const tenantId = arg('tenantId', 'abc')!;
    const seedTag = arg('seedTag', 'golden-seed')!;
    const dryRun = hasFlag('dry-run');
    const planOnly = hasFlag('plan-only');

    const calls = buildSeedCalls(seedTag);
    const appointments = buildSeedAppointments(seedTag);
    const metrics = [
        { name: 'voice_webhook_ok', value: 7, timestamp: toIsoRelative(-2, 9, 0) },
        { name: 'stream_connect_ok', value: 5, timestamp: toIsoRelative(-2, 9, 5) },
        { name: 'fallback_triggered', value: 1, timestamp: toIsoRelative(-2, 9, 10) },
        { name: 'voice_webhook_ok', value: 4, timestamp: toIsoRelative(-1, 11, 0) },
        { name: 'stream_connect_ok', value: 4, timestamp: toIsoRelative(-1, 11, 5) },
    ];

    if (planOnly) {
        console.log(JSON.stringify({
            tenantId,
            tenantName: arg('tenantName', 'Plan-only target'),
            seedTag,
            planOnly,
            inserted: {
                calls: calls.length,
                completedCalls: calls.filter((call) => call.status === 'completed').length,
                voicemails: calls.filter((call) => Boolean(call.voicemail)).length,
                recordings: calls.filter((call) => Boolean(call.recording)).length,
                appointments: appointments.length,
                upcomingAppointments: appointments.filter((appointment) => new Date(appointment.appointmentAt) > new Date()).length,
                metrics: metrics.length,
                calendarSyncRuns: 1,
            },
        }, null, 2));
        return;
    }

    const tenant = clientRegistryRepository.findById(tenantId);
    if (!tenant) {
        throw new Error(`Tenant ${tenantId} was not found in the client registry.`);
    }

    const dbDir = path.dirname(path.resolve(config.database.path));
    const clientDbPath = path.join(dbDir, `client-${tenantId}.db`);
    if (!fs.existsSync(clientDbPath)) {
        throw new Error(`Client DB not found for tenant ${tenantId} at ${clientDbPath}`);
    }

    const clientDb = getClientDatabase(tenantId);
    ensureCallRecordingSchema(tenantId);
    ensureCalendarSyncRunsTable();

    const cleanupClientTx = clientDb.transaction(() => {
        clientDb.prepare(`DELETE FROM conversation_turns WHERE call_sid LIKE ?`).run(`${seedTag}-%`);
        clientDb.prepare(`DELETE FROM voicemails WHERE call_sid LIKE ?`).run(`${seedTag}-%`);
        clientDb.prepare(`DELETE FROM call_recordings WHERE call_sid LIKE ? OR recording_sid LIKE ?`).run(`${seedTag}-%`, `${seedTag}-%`);
        clientDb.prepare(`DELETE FROM call_logs WHERE call_sid LIKE ?`).run(`${seedTag}-%`);
        clientDb.prepare(`DELETE FROM appointment_cache WHERE calendar_event_id LIKE ?`).run(`${seedTag}-%`);
        clientDb.prepare(`DELETE FROM client_metrics WHERE client_id = ? AND metadata LIKE ?`).run(tenantId, `%${seedTag}%`);
    });

    const seedClientTx = clientDb.transaction(() => {
        const insertCall = clientDb.prepare(`
            INSERT INTO call_logs (
                client_id, call_sid, caller_phone, call_direction, call_status, call_duration,
                intent_detected, conversation_summary, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertTurn = clientDb.prepare(`
            INSERT INTO conversation_turns (call_sid, turn_number, role, content, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        const insertRecording = clientDb.prepare(`
            INSERT INTO call_recordings (
                client_id, call_sid, recording_sid, recording_url, duration,
                call_direction, caller_phone, status, transcript, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertVoicemail = clientDb.prepare(`
            INSERT INTO voicemails (call_sid, client_id, recording_url, transcription_text, duration, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        const insertAppointment = clientDb.prepare(`
            INSERT INTO appointment_cache (
                client_id, calendar_event_id, provider, customer_name, customer_phone,
                customer_email, service_type, appointment_datetime, end_datetime,
                duration_minutes, status, synced_at, created_at
            ) VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMetric = clientDb.prepare(`
            INSERT INTO client_metrics (client_id, metric_name, metric_value, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (const call of calls) {
            insertCall.run(
                tenantId,
                call.callSid,
                call.callerPhone,
                call.direction,
                call.status,
                call.durationSeconds,
                call.intent,
                call.summary,
                call.createdAt
            );

            call.turns?.forEach((turn, index) => {
                insertTurn.run(call.callSid, index + 1, turn.role, turn.content, call.createdAt);
            });

            if (call.recording) {
                insertRecording.run(
                    tenantId,
                    call.callSid,
                    call.recording.recordingSid,
                    call.recording.recordingUrl,
                    call.durationSeconds,
                    call.direction,
                    call.callerPhone,
                    call.recording.status,
                    call.recording.transcript,
                    call.createdAt,
                    call.createdAt
                );
            }

            if (call.voicemail) {
                insertVoicemail.run(
                    call.callSid,
                    tenantId,
                    call.voicemail.recordingUrl,
                    call.voicemail.transcript,
                    call.voicemail.durationSeconds,
                    call.createdAt
                );
            }
        }

        for (const appointment of appointments) {
            insertAppointment.run(
                tenantId,
                appointment.eventId,
                appointment.customerName,
                appointment.customerPhone,
                appointment.customerEmail,
                appointment.serviceType,
                appointment.appointmentAt,
                appointment.endAt,
                appointment.durationMinutes,
                appointment.status,
                appointment.appointmentAt,
                appointment.appointmentAt
            );
        }

        for (const metric of metrics) {
            insertMetric.run(tenantId, metric.name, metric.value, JSON.stringify({ seedTag }), metric.timestamp);
        }
    });

    const sharedTx = sharedDb.transaction(() => {
        sharedDb.prepare(`DELETE FROM calendar_sync_runs WHERE client_id = ? AND mode = 'seed'`).run(tenantId);
        sharedDb.prepare(`
            INSERT INTO calendar_sync_runs (
                client_id, provider, mode, status, synced_count, error, started_at, finished_at
            ) VALUES (?, 'google', 'seed', 'ok', ?, NULL, ?, ?)
        `).run(tenantId, appointments.length, toIsoRelative(0, 7, 55), toIsoRelative(0, 7, 56));
    });

    if (!dryRun) {
        cleanupClientTx();
        seedClientTx();
        sharedTx();
    }

    const summary = {
        tenantId,
        tenantName: tenant.business_name,
        seedTag,
        dryRun,
        inserted: {
            calls: calls.length,
            completedCalls: calls.filter((call) => call.status === 'completed').length,
            voicemails: calls.filter((call) => Boolean(call.voicemail)).length,
            recordings: calls.filter((call) => Boolean(call.recording)).length,
            appointments: appointments.length,
            upcomingAppointments: appointments.filter((appointment) => new Date(appointment.appointmentAt) > new Date()).length,
            metrics: metrics.length,
            calendarSyncRuns: 1,
        },
    };

    console.log(JSON.stringify(summary, null, 2));
}

main();
