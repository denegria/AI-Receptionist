import { GoogleCalendarService } from './google-calendar';
import { OutlookCalendarService } from './outlook-calendar';
import { appointmentRepository } from '../../db/repositories/appointment-repository';
import { calendarCredentialsRepository, CalendarProvider } from '../../db/repositories/calendar-credentials-repository';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { sharedDb } from '../../db/shared-client';

export interface CalendarSyncResult {
  clientId: string;
  provider: CalendarProvider;
  synced: number;
  from: string;
  to: string;
  durationMs: number;
}

function ensureSyncRunsTable() {
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

function recordSyncStart(clientId: string, provider: CalendarProvider, mode: string): number {
  ensureSyncRunsTable();
  const stmt = sharedDb.prepare(
    `INSERT INTO calendar_sync_runs (client_id, provider, mode, status, started_at) VALUES (?, ?, ?, 'running', ?)`
  );
  const result = stmt.run(clientId, provider, mode, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function recordSyncFinish(runId: number, status: 'ok' | 'failed', syncedCount: number, error?: string) {
  ensureSyncRunsTable();
  const stmt = sharedDb.prepare(
    `UPDATE calendar_sync_runs SET status = ?, synced_count = ?, error = ?, finished_at = ? WHERE id = ?`
  );
  stmt.run(status, syncedCount, error || null, new Date().toISOString(), runId);
}

export function getLastCalendarSync(clientId: string) {
  ensureSyncRunsTable();
  const stmt = sharedDb.prepare(
    `SELECT id, client_id as clientId, provider, mode, status, synced_count as syncedCount, error, started_at as startedAt, finished_at as finishedAt
     FROM calendar_sync_runs
     WHERE client_id = ?
     ORDER BY id DESC LIMIT 1`
  );
  return stmt.get(clientId) as any;
}

export class CalendarSyncService {
  private googleService = new GoogleCalendarService();
  private outlookService = new OutlookCalendarService();

  private pickProvider(clientId: string): CalendarProvider {
    const googleCreds = calendarCredentialsRepository.get(clientId, 'google');
    if (googleCreds) return 'google';
    const outlookCreds = calendarCredentialsRepository.get(clientId, 'outlook');
    if (outlookCreds) return 'outlook';
    throw new Error(`No connected calendar credentials for client ${clientId}`);
  }

  async syncClient(clientId: string, opts?: { from?: string; to?: string; mode?: string; provider?: CalendarProvider }): Promise<CalendarSyncResult> {
    const tenant = clientRegistryRepository.findById(clientId);
    if (!tenant) throw new Error(`Unknown tenant: ${clientId}`);

    const provider = opts?.provider || this.pickProvider(clientId);
    const to = opts?.to || new Date().toISOString();
    const from = opts?.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const mode = opts?.mode || 'on-demand';

    const runId = recordSyncStart(clientId, provider, mode);
    const started = Date.now();

    try {
      const events = provider === 'google'
        ? await this.googleService.listEvents(clientId, from, to)
        : await this.outlookService.listEvents(clientId, from, to);

      for (const event of events) {
        const startIso = event.start || from;
        const endIso = event.end || startIso;
        const durationMinutes = Math.max(5, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));

        appointmentRepository.save({
          client_id: clientId,
          calendar_event_id: event.id,
          provider,
          customer_name: event.customerName,
          customer_email: event.customerEmail,
          customer_phone: event.customerPhone,
          service_type: event.serviceType,
          appointment_datetime: startIso,
          end_datetime: endIso,
          duration_minutes: durationMinutes,
          status: event.status,
        });
      }

      recordSyncFinish(runId, 'ok', events.length);

      return {
        clientId,
        provider,
        synced: events.length,
        from,
        to,
        durationMs: Date.now() - started,
      };
    } catch (error: any) {
      recordSyncFinish(runId, 'failed', 0, error?.message || 'Unknown sync error');
      throw error;
    }
  }

  async syncAllActive(mode: string = 'scheduled'): Promise<{ total: number; ok: number; failed: number }> {
    const clients = clientRegistryRepository.listActive();
    let ok = 0;
    let failed = 0;

    for (const client of clients) {
      try {
        await this.syncClient(client.id, { mode });
        ok += 1;
      } catch {
        failed += 1;
      }
    }

    return { total: clients.length, ok, failed };
  }
}

export const calendarSyncService = new CalendarSyncService();

let syncTimer: NodeJS.Timeout | null = null;

export function startCalendarSyncLoop() {
  const everyMin = Number(process.env.CALENDAR_SYNC_INTERVAL_MIN || '30');
  if (!Number.isFinite(everyMin) || everyMin <= 0) return;

  const intervalMs = Math.max(5, everyMin) * 60 * 1000;
  if (syncTimer) clearInterval(syncTimer);

  syncTimer = setInterval(() => {
    calendarSyncService.syncAllActive('scheduled').catch(() => undefined);
  }, intervalMs);
}

export function stopCalendarSyncLoop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
