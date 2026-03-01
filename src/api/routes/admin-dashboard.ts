import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { getClientDatabase } from '../../db/client';
import { sharedDb } from '../../db/shared-client';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { metricsRepository } from '../../db/repositories/metrics-repository';

export const adminDashboardRouter = Router();

function ensureAuditTable() {
  sharedDb.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      tenant_id TEXT,
      actor TEXT,
      reason TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function writeAudit(action: string, tenantId: string | null, reason: string | null, details?: Record<string, unknown>) {
  ensureAuditTable();
  const stmt = sharedDb.prepare(
    `INSERT INTO admin_audit_logs (action, tenant_id, actor, reason, details_json) VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(action, tenantId, 'admin_api_key', reason || null, details ? JSON.stringify(details) : null);
}

adminDashboardRouter.get('/overview', (req: Request, res: Response) => {
  const now = new Date();
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = typeof req.query.to === 'string' ? req.query.to : now.toISOString();
  const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : 'UTC';

  const clients = clientRegistryRepository.listAll();
  const dbDir = path.dirname(path.resolve(config.database.path));

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

  const tenants = clients.map((client) => {
    const dbPath = path.join(dbDir, `client-${client.id}.db`);
    if (!fs.existsSync(dbPath)) {
      return {
        tenantId: client.id,
        tenantName: client.business_name,
        totalCalls: 0,
        appointments: 0,
        estimatedRevenue: 0,
        health: 'down' as const,
      };
    }

    try {
      const db = getClientDatabase(client.id);

      const calls = (db
        .prepare(
          `SELECT COUNT(*) as total FROM call_logs
           WHERE client_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?)`
        )
        .get(client.id, from, to) as any)?.total || 0;

      const appointments = (db
        .prepare(
          `SELECT COUNT(*) as total FROM appointment_cache
           WHERE client_id = ?
           AND datetime(appointment_datetime) >= datetime(?)
           AND datetime(appointment_datetime) <= datetime(?)
           AND status IN ('confirmed', 'completed')`
        )
        .get(client.id, from, to) as any)?.total || 0;

      const estimatedRevenue = appointments * 400;

      const calendarConn = sharedDb
        .prepare(`SELECT provider, updated_at FROM calendar_credentials WHERE client_id = ? LIMIT 1`)
        .get(client.id) as { provider?: string; updated_at?: string } | undefined;

      const lastSync = sharedDb
        .prepare(
          `SELECT status, synced_count as syncedCount, finished_at as finishedAt
           FROM calendar_sync_runs
           WHERE client_id = ?
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(client.id) as { status?: string; syncedCount?: number; finishedAt?: string } | undefined;

      return {
        tenantId: client.id,
        tenantName: client.business_name,
        totalCalls: calls,
        appointments,
        estimatedRevenue,
        health: client.status === 'suspended' ? ('degraded' as const) : ('healthy' as const),
        calendarConnected: Boolean(calendarConn),
        calendarProvider: calendarConn?.provider || null,
        lastCalendarSyncAt: lastSync?.finishedAt || null,
        lastCalendarSyncStatus: lastSync?.status || null,
      };
    } catch {
      return {
        tenantId: client.id,
        tenantName: client.business_name,
        totalCalls: 0,
        appointments: 0,
        estimatedRevenue: 0,
        health: 'down' as const,
      };
    }
  });

  const totals = {
    totalTenants: tenants.length,
    totalCalls: tenants.reduce((sum, t) => sum + t.totalCalls, 0),
    totalAppointments: tenants.reduce((sum, t) => sum + t.appointments, 0),
    estimatedRevenue: tenants.reduce((sum, t) => sum + t.estimatedRevenue, 0),
    calendarConnectedTenants: tenants.filter((t: any) => t.calendarConnected).length,
    calendarSyncHealthyTenants: tenants.filter((t: any) => t.lastCalendarSyncStatus === 'ok').length,
  };

  res.json({ from, to, timezone, tenants, totals });
});

adminDashboardRouter.post('/actions', (req: Request, res: Response) => {
  const { action, tenantId, reason } = req.body || {};
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'Missing action' });
  }

  const allowedActions = new Set(['resync_config', 'reprocess_metrics']);
  if (!allowedActions.has(action)) {
    return res.status(400).json({ error: 'Unsupported action' });
  }

  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'Missing tenantId' });
  }

  const tenant = clientRegistryRepository.findById(tenantId);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }

  const dbDir = path.dirname(path.resolve(config.database.path));
  const dbPath = path.join(dbDir, `client-${tenantId}.db`);
  if (!fs.existsSync(dbPath)) {
    writeAudit(action, tenantId, reason || null, { ok: false, reason: 'missing_client_db' });
    return res.status(404).json({ error: `Client DB missing for tenant ${tenantId}` });
  }

  // v1 guarded action behavior: validated + audited no-op hooks.
  writeAudit(action, tenantId, reason || null, { ok: true, mode: 'scaffold_noop' });

  return res.json({
    success: true,
    action,
    tenantId,
    status: 'queued',
    message: 'Action accepted and audited (scaffold).',
  });
});

adminDashboardRouter.get('/twilio-observability', (req: Request, res: Response) => {
  const windowMinRaw = Number(req.query.windowMin || 15);
  const windowMin = Number.isFinite(windowMinRaw) ? Math.max(1, Math.min(1440, windowMinRaw)) : 15;
  const sinceIso = new Date(Date.now() - windowMin * 60 * 1000).toISOString();

  const clients = clientRegistryRepository.listAll();
  const dbDir = path.dirname(path.resolve(config.database.path));

  const tenants = clients.map((client) => {
    const dbPath = path.join(dbDir, `client-${client.id}.db`);
    if (!fs.existsSync(dbPath)) {
      return {
        tenantId: client.id,
        tenantName: client.business_name,
        available: false,
      };
    }

    const get = (metricName: any) => {
      const points = metricsRepository.getMetrics(client.id, metricName, sinceIso);
      return points.reduce((sum, p) => sum + p.metric_value, 0);
    };

    const webhookOk = get('voice_webhook_ok');
    const webhookErr = get('voice_webhook_error');
    const streamOk = get('stream_connect_ok');
    const streamErr = get('stream_connect_error');
    const fallback = get('fallback_triggered');
    const calls = Math.max(webhookOk, streamOk);

    return {
      tenantId: client.id,
      tenantName: client.business_name,
      available: true,
      calls,
      webhookOk,
      webhookErr,
      streamOk,
      streamErr,
      fallback,
      fallbackRatePct: calls > 0 ? Number(((fallback / calls) * 100).toFixed(2)) : 0,
      streamErrorRatePct: streamOk + streamErr > 0 ? Number(((streamErr / (streamOk + streamErr)) * 100).toFixed(2)) : 0,
    };
  });

  const totals = tenants.reduce(
    (acc: any, t: any) => {
      if (!t.available) return acc;
      acc.calls += t.calls;
      acc.webhookOk += t.webhookOk;
      acc.webhookErr += t.webhookErr;
      acc.streamOk += t.streamOk;
      acc.streamErr += t.streamErr;
      acc.fallback += t.fallback;
      return acc;
    },
    { calls: 0, webhookOk: 0, webhookErr: 0, streamOk: 0, streamErr: 0, fallback: 0 }
  );

  res.json({
    since: sinceIso,
    windowMin,
    tenants,
    totals: {
      ...totals,
      fallbackRatePct: totals.calls > 0 ? Number(((totals.fallback / totals.calls) * 100).toFixed(2)) : 0,
      streamErrorRatePct: totals.streamOk + totals.streamErr > 0 ? Number(((totals.streamErr / (totals.streamOk + totals.streamErr)) * 100).toFixed(2)) : 0,
    },
  });
});

adminDashboardRouter.get('/audit-logs', (req: Request, res: Response) => {
  ensureAuditTable();
  const limitRaw = Number(req.query.limit || 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

  const rows = sharedDb
    .prepare(`SELECT id, action, tenant_id as tenantId, actor, reason, details_json as detailsJson, created_at as createdAt FROM admin_audit_logs ORDER BY id DESC LIMIT ?`)
    .all(limit) as Array<{
      id: number;
      action: string;
      tenantId: string | null;
      actor: string | null;
      reason: string | null;
      detailsJson: string | null;
      createdAt: string;
    }>;

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      tenantId: r.tenantId,
      actor: r.actor,
      reason: r.reason,
      details: r.detailsJson ? JSON.parse(r.detailsJson) : null,
      createdAt: r.createdAt,
    })),
  });
});
