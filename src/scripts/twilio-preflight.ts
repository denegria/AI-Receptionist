/* eslint-disable no-console */
function arg(name: string, fallback = ''): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

async function main() {
  const publicUrl = (arg('publicUrl', process.env.PUBLIC_URL || '') || '').replace(/\/$/, '');
  const clientId = arg('clientId', 'abc');
  const adminKey = process.env.ADMIN_API_KEY;

  if (!publicUrl) throw new Error('PUBLIC_URL is required (or pass --publicUrl)');
  if (!adminKey) throw new Error('ADMIN_API_KEY is required for preflight');

  const healthz = await fetch(`${publicUrl}/healthz`);
  if (!healthz.ok) throw new Error(`healthz failed: ${healthz.status}`);

  const form = new URLSearchParams({
    CallSid: `CA_PREFLIGHT_${Date.now()}`,
    To: '+15555550123',
    From: '+15555550999',
  });

  const voiceRes = await fetch(`${publicUrl}/voice?clientId=${encodeURIComponent(clientId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-preflight-key': adminKey,
    },
    body: form.toString(),
  });

  const twiml = await voiceRes.text();
  if (!voiceRes.ok) throw new Error(`voice webhook failed: ${voiceRes.status} ${twiml.slice(0, 200)}`);
  if (!twiml.includes('<Connect>') || !twiml.includes('<Stream')) {
    throw new Error(`voice webhook did not return stream TwiML. first200=${twiml.slice(0, 200)}`);
  }

  const wsUrl = new URL(publicUrl);
  wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.pathname = '/media-stream';

  console.log(JSON.stringify({
    ok: true,
    checks: {
      healthz: true,
      voiceTwimlStream: true,
      wsUrl: wsUrl.toString(),
    },
    clientId,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
  process.exit(1);
});
