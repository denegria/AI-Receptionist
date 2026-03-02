# AI Receptionist Backend

Operator-facing backend for SwiftBookPro voice + scheduling + dashboard APIs.

## Stack
- Node.js + TypeScript (CommonJS)
- Express + express-ws + Socket.IO transport support
- SQLite (`better-sqlite3`) with shared registry + client shards
- Twilio media/webhooks
- Google + Outlook calendar integrations

## What this repo owns
- Telephony ingress, stream lifecycle, call-state handling
- AI/tool orchestration and scheduling services
- Calendar OAuth + calendar sync/listing + selection
- Dashboard/admin API data endpoints consumed by frontend
- Client onboarding ingestion and registry updates

## High-level architecture
- `shared.db`: tenant registry + shared control-plane data
- `client-*.db`: tenant-scoped operational data (calls, appointments, voicemails, metrics)
- `src/api/routes/*`: authenticated HTTP routes
- `src/services/*`: telephony/AI/scheduling business logic

## API auth model
- Protected API routes require `x-api-key` (or bearer) == `ADMIN_API_KEY`
- Frontend server proxy handles this for browser clients

## Calendar flows (current)
- OAuth routes:
  - `GET /auth/google/login?clientId=...`
  - `GET /auth/microsoft/login?clientId=...`
  - callbacks for each provider
- Calendar settings/actions (used by frontend settings page):
  - `GET /api/calendar/settings?clientId=...`
  - `PUT /api/calendar/settings` (`selectedAccountId`, `selectedCalendarIds[]` supported)
  - `POST /api/calendar/actions` (`connect|reconnect|disconnect`)

## Runtime commands
```bash
npm install
npm run dev
npm run build
npm start
```

## Health + checks
- Public health: `GET /healthz`
- Legacy health: `GET /health`

## Test/ops scripts
```bash
npm run twilio:preflight
npm run twilio:alerts
npm run test:synthetic:single
npm run test:synthetic:matrix
```

## Performance/cost reference (keep)
Previously validated production call-path improvements:
- Turn overhead reduced to ~300–500ms class (after VAD/flow tuning)
- Prompt-caching strategy materially reduced effective LLM input cost on multi-turn calls

(Keep this section directional; for exact up-to-date numbers, use current logs/bench runs.)

## Deployment
- Fly deployment is active (`fly.toml`)
- Dockerfile remains in use for build/runtime packaging
- Persistent app data mounted at `/app/data`

## Env vars (critical subset)
- `ADMIN_API_KEY`
- `PUBLIC_URL`
- `ENCRYPTION_KEY`
- Provider credentials (Twilio, Google, Microsoft, AI/STT/TTS)
- DB/data path vars when overriding defaults

See `.env.example` for full key list.

## Repo hygiene rules
- No raw incident log dumps in repo root
- Keep roadmap in `SCALE_ROADMAP.md` (authoritative planning file)
- If API contract changes, update README endpoints in same PR
