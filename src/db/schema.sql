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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(client_id, calendar_event_id)
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

-- Conversation Turns (Transcript lines)
CREATE TABLE IF NOT EXISTS conversation_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sid TEXT NOT NULL,
    turn_number INTEGER NOT NULL,
    role TEXT CHECK(role IN ('user', 'assistant')) NOT NULL,
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(call_sid) REFERENCES call_logs(call_sid)
);

-- Voicemails (Fallback)
CREATE TABLE IF NOT EXISTS voicemails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sid TEXT NOT NULL,
    client_id TEXT NOT NULL,
    recording_url TEXT,
    transcription_text TEXT,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(call_sid) REFERENCES call_logs(call_sid)
);

CREATE INDEX IF NOT EXISTS idx_voicemails_call_sid ON voicemails(call_sid);
CREATE INDEX IF NOT EXISTS idx_voicemails_client_id ON voicemails(client_id);
CREATE INDEX IF NOT EXISTS idx_turns_call_sid ON conversation_turns(call_sid);

-- Client Metrics (Usage tracking for billing)
CREATE TABLE IF NOT EXISTS client_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metadata TEXT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metrics_name ON client_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON client_metrics(timestamp);

-- System Logs (Stored in legacy shared DB)
CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    meta TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
