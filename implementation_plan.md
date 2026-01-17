# AI Receptionist MVP - Implementation Plan (FINAL - Calendar Integration)

## Goal
Build an AI voice receptionist to handle after-hours calls for service businesses (HVAC, Trades). The AI will answer calls, conversationally determine intent (Book, Reschedule, Cancel), and manage appointments via **Google Calendar** or **Outlook Calendar** integration.

## Tech Stack
- **Backend**: Node.js v20+ with TypeScript, Express + express-ws
- **Voice & AI**:
    - **Telephony**: Twilio (Media Streams)
    - **STT**: Deepgram (streaming, $0.0043/min)
    - **LLM**: Claude 3 Haiku (test first) or GPT-4o (fallback)
    - **TTS**: Deepgram Aura (streaming, $0.015/1K chars)
- **Calendar Integration**:
    - Google Calendar API (OAuth 2.0)
    - Microsoft Graph API (Outlook Calendar)
    - Internal SQLite cache for fast availability checks
- **Data**:
    - SQLite (call logs, client configs, appointment cache)
    - JSON files per client (flexible business hours, calendar choice)
- **Cost**: ~$0.22/call (voice AI) + free calendar APIs

## Calendar Integration Strategy
### How It Works:
1. **AI Books Appointment**
2. **Check Client Config**: Which calendar?
    - **Google Calendar** → Create event via Google Calendar API
    - **Outlook Calendar** → Create event via Microsoft Graph API
    - **Both (Sync Mode)** → Create in both calendars
3. **Cache in SQLite** (for fast offline availability checks)
4. **Return confirmation to caller**

## File Structure
```text
src/
├── server.ts
├── config.ts
│
├── middleware/
│   ├── business-hours.ts
│   └── security.ts
│
├── routes/
│   ├── twilio-webhook.ts
│   ├── media-stream.ts
│   ├── admin.ts
│   └── calendar-auth.ts          # NEW: OAuth flow handlers
│
├── services/
│   ├── twilio.ts
│   ├── stream-handler.ts
│   ├── stt.ts
│   ├── tts.ts
│   ├── llm.ts
│   ├── intent-detector.ts
│   ├── call-router.ts
│   ├── logger.ts
│   │
│   └── scheduling/               # NEW: Calendar services
│       ├── scheduler.ts          # Main scheduling logic
│       ├── google-calendar.ts    # Google Calendar integration
│       ├── outlook-calendar.ts   # Outlook Calendar integration
│       └── cache.ts              # SQLite appointment cache
│
├── models/
│   ├── conversation-state.ts
│   ├── intent.ts
│   ├── client-config.ts
│   └── appointment.ts            # NEW: Appointment data model
│
├── functions/
│   └── tools.ts
│
├── utils/
│   └── validators.ts
│
└── db/
    ├── schema.sql
    └── client.ts

config/
└── clients/
    ├── client-abc.json
    └── client-xyz.json
```

## Client Config Example
`config/clients/client-abc.json`
```json
{
  "clientId": "hvac-co-123",
  "businessName": "ABC Heating & Air",
  "phoneNumber": "+15551234567",
  "timezone": "America/New_York",
  
  "businessHours": {
    "monday": {"start": "08:00", "end": "17:00", "enabled": true},
    "tuesday": {"start": "08:00", "end": "17:00", "enabled": true},
    "wednesday": {"start": "08:00", "end": "17:00", "enabled": true},
    "thursday": {"start": "08:00", "end": "17:00", "enabled": true},
    "friday": {"start": "08:00", "end": "17:00", "enabled": true},
    "saturday": {"start": "09:00", "end": "13:00", "enabled": true},
    "sunday": {"enabled": false}
  },
  
  "holidays": ["2025-12-25", "2025-01-01"],
  
  "appointmentTypes": [
    {
      "name": "HVAC Repair",
      "duration": 60,
      "bufferBefore": 0,
      "bufferAfter": 15
    },
    {
      "name": "Maintenance",
      "duration": 30,
      "bufferBefore": 0,
      "bufferAfter": 10
    }
  ],
  
  "calendar": {
    "provider": "google",
    "calendarId": "primary",
    "credentials": {
      "type": "oauth2",
      "refreshToken": "encrypted_token_here"
    },
    "syncEnabled": true,
    "createMeetLinks": false
  },
  
  "routing": {
    "afterHoursAction": "ai_receptionist",
    "fallbackNumber": "+15559876543",
    "voicemailEnabled": true
  },
  
  "aiSettings": {
    "greeting": "Hello, thanks for calling ABC Heating & Air. I'm the automated assistant. How can I help you today?",
    "maxRetries": 3,
    "requireServiceType": false
  }
}
```

## Database Schema (`src/db/schema.sql`)
```sql
-- Calendar Credentials (encrypted)
CREATE TABLE IF NOT EXISTS calendar_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'outlook')),
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TEXT,
  calendar_id TEXT DEFAULT 'primary',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Appointment Cache (synced from calendars)
CREATE TABLE IF NOT EXISTS appointment_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  calendar_event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  service_type TEXT,
  appointment_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT DEFAULT 'confirmed',
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appt_cache_client ON appointment_cache(client_id);
CREATE INDEX IF NOT EXISTS idx_appt_cache_datetime ON appointment_cache(appointment_datetime);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_cache_event ON appointment_cache(client_id, calendar_event_id);

-- Call Logs (Debugging & Tracking)
CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  call_sid TEXT UNIQUE,
  caller_phone TEXT,
  call_direction TEXT,
  call_status TEXT,
  call_duration INTEGER,
  intent_detected TEXT,
  conversation_summary TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_date ON call_logs(created_at);
```

## Step-by-Step Implementation

### Phase 1: Setup (Foundation) [COMPLETED]
- Git, Node.js, Express, Basic Server.

### Phase 2: Configuration & Database
- **Refactor `config.ts`** to support Google/Outlook credentials.
- **Database Schema**: Tables for `appointments` (cache) and `auth_tokens`.
- **Client Config**: Add fields for `calendarProvider` (google/outlook/both).

### Phase 3: Calendar Services
- **Google Service**: OAuth + Calendar API (insert, list).
- **Outlook Service**: Graph API (insert, list).
- **Scheduler**: Unified interface (`bookSlot`, `checkAvailability`).

### Phase 4: Core Logic & Voice
- Twilio Webhook -> STT -> LLM -> Scheduler tools -> TTS.

### Phase 5: Testing
- Verify calendar event creation on real Google/Outlook accounts.

