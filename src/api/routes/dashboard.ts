import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { getClientDatabase } from '../../db/client';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';

export const dashboardRouter = Router();

function rangeFromQuery(req: Request) {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const from = typeof req.query.from === 'string' ? req.query.from : defaultFrom.toISOString();
  const to = typeof req.query.to === 'string' ? req.query.to : now.toISOString();
  const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : 'UTC';

  return { from, to, timezone };
}

function requireTenantId(req: Request, res: Response): string | null {
  const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
  if (!tenantId) {
    res.status(400).json({ error: 'Missing tenantId' });
    return null;
  }
  return tenantId;
}

function dbExistsForTenant(tenantId: string): boolean {
  const dbDir = path.dirname(path.resolve(config.database.path));
  const clientDbPath = path.join(dbDir, `client-${tenantId}.db`);
  return fs.existsSync(clientDbPath);
}

const CONVERSION_DEFINITIONS = {
  lead: "Inbound call_logs rows in selected range",
  qualified: "Inbound call_logs rows with non-empty intent_detected in selected range",
  booked: "appointment_cache rows with status in (confirmed, completed) in selected range",
};

function pctChange(current: number, previous: number): number {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

dashboardRouter.get('/summary', (req: Request, res: Response) => {
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;

  if (!dbExistsForTenant(tenantId)) {
    return res.status(404).json({ error: `No client database found for tenant ${tenantId}` });
  }

  const { from, to, timezone } = rangeFromQuery(req);
  const db = getClientDatabase(tenantId);

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const periodMs = Math.max(1, toMs - fromMs);
  const prevFrom = new Date(fromMs - periodMs).toISOString();
  const prevTo = new Date(toMs - periodMs).toISOString();

  const totalCallsRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
    )
    .get(tenantId, from, to) as { total: number };

  const prevTotalCallsRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
    )
    .get(tenantId, prevFrom, prevTo) as { total: number };

  const appointmentsRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM appointment_cache
       WHERE client_id = ?
       AND datetime(appointment_datetime) >= datetime(?)
       AND datetime(appointment_datetime) <= datetime(?)
       AND status IN ('confirmed', 'completed')`
    )
    .get(tenantId, from, to) as { total: number };

  const prevAppointmentsRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM appointment_cache
       WHERE client_id = ?
       AND datetime(appointment_datetime) >= datetime(?)
       AND datetime(appointment_datetime) <= datetime(?)
       AND status IN ('confirmed', 'completed')`
    )
    .get(tenantId, prevFrom, prevTo) as { total: number };

  const avgDurationRow = db
    .prepare(
      `SELECT AVG(call_duration) as avgDuration FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       AND call_duration IS NOT NULL`
    )
    .get(tenantId, from, to) as { avgDuration: number | null };

  const prevAvgDurationRow = db
    .prepare(
      `SELECT AVG(call_duration) as avgDuration FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       AND call_duration IS NOT NULL`
    )
    .get(tenantId, prevFrom, prevTo) as { avgDuration: number | null };

  const totalCalls = totalCallsRow?.total || 0;
  const prevTotalCalls = prevTotalCallsRow?.total || 0;
  const appointments = appointmentsRow?.total || 0;
  const prevAppointments = prevAppointmentsRow?.total || 0;
  const avgDurationSeconds = Math.round(avgDurationRow?.avgDuration || 0);
  const prevAvgDurationSeconds = Math.round(prevAvgDurationRow?.avgDuration || 0);
  const estimatedSavings = appointments * 85;
  const prevEstimatedSavings = prevAppointments * 85;

  res.json({
    tenantId,
    from,
    to,
    timezone,
    compareMode: (req.query.compareMode as string) || 'none',
    kpis: [
      {
        id: 'totalCalls',
        label: 'Total Calls',
        value: totalCalls,
        formatted: totalCalls.toLocaleString(),
        changePct: pctChange(totalCalls, prevTotalCalls),
      },
      {
        id: 'appointments',
        label: 'Appointments',
        value: appointments,
        formatted: appointments.toLocaleString(),
        changePct: pctChange(appointments, prevAppointments),
      },
      {
        id: 'avgDurationSeconds',
        label: 'Avg. Duration',
        value: avgDurationSeconds,
        formatted: `${Math.floor(avgDurationSeconds / 60)}m ${String(avgDurationSeconds % 60).padStart(2, '0')}s`,
        changePct: pctChange(avgDurationSeconds, prevAvgDurationSeconds),
      },
      {
        id: 'estimatedSavings',
        label: 'AI Savings',
        value: estimatedSavings,
        formatted: `$${estimatedSavings.toLocaleString()}`,
        changePct: pctChange(estimatedSavings, prevEstimatedSavings),
      },
    ],
  });
});

dashboardRouter.get('/metrics', (req: Request, res: Response) => {
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;

  if (!dbExistsForTenant(tenantId)) {
    return res.status(404).json({ error: `No client database found for tenant ${tenantId}` });
  }

  const { from, to, timezone } = rangeFromQuery(req);
  const db = getClientDatabase(tenantId);

  const rows = db
    .prepare(
      `SELECT date(created_at) as day,
              COUNT(*) as calls,
              SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) as completed_calls
       FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       GROUP BY date(created_at)
       ORDER BY day ASC`
    )
    .all(tenantId, from, to) as Array<{ day: string; calls: number; completed_calls: number }>;

  const points = rows.map((row) => ({
    ts: new Date(`${row.day}T00:00:00.000Z`).toISOString(),
    calls: row.calls || 0,
    appointments: Math.round((row.completed_calls || 0) * 0.25),
  }));

  res.json({ tenantId, from, to, timezone, points });
});

dashboardRouter.get('/calls', (req: Request, res: Response) => {
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;

  if (!dbExistsForTenant(tenantId)) {
    return res.status(404).json({ error: `No client database found for tenant ${tenantId}` });
  }

  const { from, to, timezone } = rangeFromQuery(req);
  const db = getClientDatabase(tenantId);

  const rows = db
    .prepare(
      `SELECT call_sid, caller_phone, call_direction, call_status, call_duration, created_at
       FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       ORDER BY datetime(created_at) DESC
       LIMIT 100`
    )
    .all(tenantId, from, to) as Array<{
      call_sid: string;
      caller_phone: string;
      call_direction: string;
      call_status: string;
      call_duration: number | null;
      created_at: string;
    }>;

  const items = rows.map((row, idx) => ({
    id: row.call_sid || `call-${idx + 1}`,
    direction: row.call_direction === 'outbound' ? 'outgoing' : 'incoming',
    phone: row.caller_phone || 'Unknown',
    startedAt: new Date(row.created_at).toISOString(),
    durationSeconds: row.call_duration || 0,
    status: row.call_status === 'completed' ? 'completed' : row.call_status === 'failed' ? 'failed' : 'missed',
  }));

  res.json({ tenantId, from, to, timezone, items });
});

dashboardRouter.get('/conversions', (req: Request, res: Response) => {
  const tenantId = requireTenantId(req, res);
  if (!tenantId) return;

  if (!dbExistsForTenant(tenantId)) {
    return res.status(404).json({ error: `No client database found for tenant ${tenantId}` });
  }

  const { from, to, timezone } = rangeFromQuery(req);
  const db = getClientDatabase(tenantId);

  const leadCountRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       AND call_direction = 'inbound'`
    )
    .get(tenantId, from, to) as { total: number };

  const qualifiedCountRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM call_logs
       WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)
       AND call_direction = 'inbound'
       AND intent_detected IS NOT NULL
       AND trim(intent_detected) != ''`
    )
    .get(tenantId, from, to) as { total: number };

  const bookedCountRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM appointment_cache
       WHERE client_id = ?
       AND datetime(appointment_datetime) >= datetime(?)
       AND datetime(appointment_datetime) <= datetime(?)
       AND status IN ('confirmed', 'completed')`
    )
    .get(tenantId, from, to) as { total: number };

  res.json({
    tenantId,
    from,
    to,
    timezone,
    leadCount: leadCountRow?.total || 0,
    qualifiedCount: qualifiedCountRow?.total || 0,
    bookedCount: bookedCountRow?.total || 0,
    definitions: CONVERSION_DEFINITIONS,
  });
});

dashboardRouter.get('/storage-check', (_req: Request, res: Response) => {
  const clients = clientRegistryRepository.listAll();
  const dbDir = path.dirname(path.resolve(config.database.path));

  const report = clients.map((client) => {
    const dbPath = path.join(dbDir, `client-${client.id}.db`);
    const exists = fs.existsSync(dbPath);
    let counts = { callLogs: 0, appointments: 0, metrics: 0 };

    if (exists) {
      try {
        const db = getClientDatabase(client.id);
        counts = {
          callLogs: (db.prepare('SELECT COUNT(*) as total FROM call_logs WHERE client_id = ?').get(client.id) as any)?.total || 0,
          appointments:
            (db.prepare('SELECT COUNT(*) as total FROM appointment_cache WHERE client_id = ?').get(client.id) as any)?.total || 0,
          metrics: (db.prepare('SELECT COUNT(*) as total FROM client_metrics WHERE client_id = ?').get(client.id) as any)?.total || 0,
        };
      } catch {
        // Keep default counts if DB open/query fails.
      }
    }

    return {
      tenantId: client.id,
      businessName: client.business_name,
      status: client.status,
      hasClientDatabase: exists,
      ...counts,
    };
  });

  res.json({ totalClients: clients.length, report });
});
