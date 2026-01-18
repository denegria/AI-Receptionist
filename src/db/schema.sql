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
  status TEXT DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled', 'completed', 'no-show')),
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Call Logs
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
