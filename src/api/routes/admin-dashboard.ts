import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { getClientDatabase } from '../../db/client';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';

export const adminDashboardRouter = Router();

adminDashboardRouter.get('/overview', (req: Request, res: Response) => {
  const now = new Date();
  const from = typeof req.query.from === 'string' ? req.query.from : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = typeof req.query.to === 'string' ? req.query.to : now.toISOString();
  const timezone = typeof req.query.timezone === 'string' ? req.query.timezone : 'UTC';

  const clients = clientRegistryRepository.listAll();
  const dbDir = path.dirname(path.resolve(config.database.path));

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

      return {
        tenantId: client.id,
        tenantName: client.business_name,
        totalCalls: calls,
        appointments,
        estimatedRevenue,
        health: client.status === 'suspended' ? ('degraded' as const) : ('healthy' as const),
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
  };

  res.json({ from, to, timezone, tenants, totals });
});
