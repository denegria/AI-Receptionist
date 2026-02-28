import { db } from '../client';
import { clientRegistryRepository } from './client-registry-repository';

export type CalendarProvider = 'google' | 'outlook';

export interface CalendarCredentialRow {
  id: number;
  client_id: string;
  provider: CalendarProvider;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | number | null;
  calendar_id: string;
  account_email: string | null;
  calendar_timezone: string | null;
  created_at: string;
  updated_at: string;
}

interface UpsertCalendarCredentialInput {
  clientId: string;
  provider: CalendarProvider;
  refreshToken: string | null;
  accessToken: string | null;
  tokenExpiresAt: string | number | null;
  calendarId?: string;
  accountEmail?: string | null;
  calendarTimezone?: string | null;
}

function ensureClientExists(clientId: string): void {
  if (!clientId || !clientRegistryRepository.findById(clientId)) {
    throw new Error(`Unknown or unauthorized clientId: ${clientId}`);
  }
}

function ensureCalendarCredentialColumns(): void {
  const columns = db
    .prepare(`PRAGMA table_info(calendar_credentials)`)
    .all() as Array<{ name: string }>;

  const names = new Set(columns.map((c) => c.name));

  if (!names.has('account_email')) {
    db.exec(`ALTER TABLE calendar_credentials ADD COLUMN account_email TEXT`);
  }

  if (!names.has('calendar_timezone')) {
    db.exec(`ALTER TABLE calendar_credentials ADD COLUMN calendar_timezone TEXT`);
  }
}

export class CalendarCredentialsRepository {
  constructor() {
    ensureCalendarCredentialColumns();
  }

  upsert(input: UpsertCalendarCredentialInput): void {
    ensureClientExists(input.clientId);

    const stmt = db.prepare(`
      INSERT INTO calendar_credentials (
        client_id,
        provider,
        refresh_token,
        access_token,
        token_expires_at,
        calendar_id,
        account_email,
        calendar_timezone
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_id) DO UPDATE SET
        provider = excluded.provider,
        refresh_token = COALESCE(excluded.refresh_token, refresh_token),
        access_token = excluded.access_token,
        token_expires_at = excluded.token_expires_at,
        calendar_id = COALESCE(excluded.calendar_id, calendar_id),
        account_email = COALESCE(excluded.account_email, account_email),
        calendar_timezone = COALESCE(excluded.calendar_timezone, calendar_timezone),
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      input.clientId,
      input.provider,
      input.refreshToken,
      input.accessToken,
      input.tokenExpiresAt,
      input.calendarId || 'primary',
      input.accountEmail || null,
      input.calendarTimezone || null
    );
  }

  get(clientId: string, provider: CalendarProvider): CalendarCredentialRow | null {
    ensureClientExists(clientId);
    const stmt = db.prepare(
      `SELECT * FROM calendar_credentials WHERE client_id = ? AND provider = ?`
    );
    return (stmt.get(clientId, provider) as CalendarCredentialRow) || null;
  }

  setCalendarSelection(
    clientId: string,
    provider: CalendarProvider,
    calendarId: string,
    calendarTimezone?: string | null
  ): void {
    ensureClientExists(clientId);

    const stmt = db.prepare(`
      UPDATE calendar_credentials
      SET calendar_id = ?,
          calendar_timezone = COALESCE(?, calendar_timezone),
          updated_at = CURRENT_TIMESTAMP
      WHERE client_id = ? AND provider = ?
    `);

    const result = stmt.run(calendarId, calendarTimezone || null, clientId, provider);
    if (result.changes === 0) {
      throw new Error(`No calendar connection found for client ${clientId} (${provider})`);
    }
  }
}

export const calendarCredentialsRepository = new CalendarCredentialsRepository();
