/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';
import { clientRegistryRepository } from '../db/repositories/client-registry-repository';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function getMetricCount(db: Database.Database, clientId: string, metricName: string, sinceIso: string): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(metric_value), 0) as total
     FROM client_metrics
     WHERE client_id = ? AND metric_name = ? AND datetime(timestamp) >= datetime(?)`
  ).get(clientId, metricName, sinceIso) as any;
  return Number(row?.total || 0);
}

function main() {
  const windowMinutes = Number(arg('windowMin', '15'));
  const fallbackThresholdPct = Number(arg('fallbackPct', '10'));
  const minCalls = Number(arg('minCalls', '10'));

  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const dbDir = path.dirname(path.resolve(config.database.path));

  const clients = clientRegistryRepository.listAll();
  const alerts: Array<Record<string, unknown>> = [];
  const stats: Array<Record<string, unknown>> = [];

  for (const client of clients) {
    const dbPath = path.join(dbDir, `client-${client.id}.db`);
    if (!fs.existsSync(dbPath)) continue;

    const db = new Database(dbPath, { readonly: true });
    try {
      const webhookOk = getMetricCount(db, client.id, 'voice_webhook_ok', since);
      const webhookErr = getMetricCount(db, client.id, 'voice_webhook_error', since);
      const streamOk = getMetricCount(db, client.id, 'stream_connect_ok', since);
      const streamErr = getMetricCount(db, client.id, 'stream_connect_error', since);
      const fallback = getMetricCount(db, client.id, 'fallback_triggered', since);

      const calls = Math.max(webhookOk, streamOk);
      const fallbackRate = calls > 0 ? (fallback / calls) * 100 : 0;
      const streamErrRate = streamOk + streamErr > 0 ? (streamErr / (streamOk + streamErr)) * 100 : 0;

      stats.push({
        clientId: client.id,
        calls,
        webhookOk,
        webhookErr,
        streamOk,
        streamErr,
        fallback,
        fallbackRatePct: Number(fallbackRate.toFixed(2)),
        streamErrRatePct: Number(streamErrRate.toFixed(2)),
      });

      if (calls >= minCalls && fallbackRate > fallbackThresholdPct) {
        alerts.push({
          clientId: client.id,
          type: 'fallback_rate_high',
          thresholdPct: fallbackThresholdPct,
          actualPct: Number(fallbackRate.toFixed(2)),
          calls,
          fallback,
        });
      }

      if (streamOk + streamErr >= minCalls && streamErrRate > 10) {
        alerts.push({
          clientId: client.id,
          type: 'stream_connect_error_rate_high',
          thresholdPct: 10,
          actualPct: Number(streamErrRate.toFixed(2)),
          streamOk,
          streamErr,
        });
      }

      if (webhookErr >= Math.max(3, Math.floor(calls * 0.2))) {
        alerts.push({
          clientId: client.id,
          type: 'voice_webhook_errors_spike',
          webhookErr,
          calls,
        });
      }
    } finally {
      db.close();
    }
  }

  const out = {
    ok: alerts.length === 0,
    since,
    windowMinutes,
    checkedClients: stats.length,
    alerts,
    stats,
  };

  console.log(JSON.stringify(out, null, 2));
  if (alerts.length > 0) process.exit(2);
}

main();
