import { io } from 'socket.io-client';
import Database from 'better-sqlite3';
import path from 'path';

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const mode = arg('mode', 'single');
const tenants = Number(arg('tenants', '5'));
const concurrency = Number(arg('concurrency', '2'));
const baseUrl = arg('url', process.env.SYNTHETIC_BASE_URL || 'http://127.0.0.1:8080');
const socketPath = arg('socketPath', process.env.SOCKET_IO_PATH || '/socket.io-media-stream');
const scenario = arg('scenario', 'hibye');
const callMs = Number(arg('callMs', '800'));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOneCall(clientId: string, i: number): Promise<{ ok: boolean; durationMs: number }> {
  const started = Date.now();
  const callSid = `syn-${clientId}-${i}-${Date.now()}`;

  return await new Promise((resolve) => {
    const socket = io(baseUrl, {
      path: socketPath,
      // Do not force websocket-only; allow Engine.IO to negotiate best transport on Fly edge.
      query: { clientId },
      reconnection: false,
      timeout: 5000,
    });

    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.disconnect(); } catch {}
      resolve({ ok, durationMs: Date.now() - started });
    };

    socket.on('connect_error', () => finish(false));
    socket.on('error', () => finish(false));

    socket.on('connect', async () => {
      socket.emit('twilio-message', {
        event: 'start',
        start: {
          streamSid: `MZ${callSid}`,
          callSid,
          customParameters: {
            clientId,
            callerPhone: '+15550001111',
          },
        },
      });

      if (scenario === 'hibye') {
        socket.emit('twilio-message', {
          event: 'media',
          media: {
            payload: Buffer.from('hello').toString('base64'),
          },
        });
      }

      await sleep(callMs);
      socket.emit('twilio-message', { event: 'stop' });
      await sleep(120);
      finish(true);
    });
  });
}

async function main() {
  const matrixTenants = mode === 'matrix'
    ? Array.from({ length: tenants }, (_, i) => `tenant-${i + 1}`)
    : ['abc'];

  const planned = matrixTenants.flatMap((tenant) =>
    Array.from({ length: concurrency }, (_, i) => ({ tenant, i }))
  );

  const results = await Promise.all(planned.map((p) => runOneCall(p.tenant, p.i)));
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const avgMs = results.length ? Math.round(results.reduce((a, b) => a + b.durationMs, 0) / results.length) : 0;

  let dbMetrics: any = null;
  try {
    const dbPath = process.env.DB_PATH || './receptionist.db';
    const resolved = path.resolve(dbPath);
    const db = new Database(resolved, { readonly: true });
    const totalCalls = db.prepare('SELECT COUNT(*) as c FROM call_logs').get() as { c: number };
    const completedCalls = db.prepare("SELECT COUNT(*) as c FROM call_logs WHERE call_status = 'completed'").get() as { c: number };
    dbMetrics = { dbPath: resolved, totalCalls: totalCalls.c, completedCalls: completedCalls.c };
    db.close();
  } catch {
    dbMetrics = { warning: 'Unable to read DB metrics (DB_PATH missing or DB not initialized)' };
  }

  const summary = {
    mode,
    scenario,
    baseUrl,
    socketPath,
    plannedCalls: planned.length,
    ok,
    fail,
    avgDurationMs: avgMs,
    dbMetrics,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (fail > 0) process.exit(2);
}

main().catch((err) => {
  console.error('synthetic-load-test failed', err);
  process.exit(1);
});
