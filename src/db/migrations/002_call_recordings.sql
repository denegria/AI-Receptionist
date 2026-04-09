-- Dedicated all-call recordings catalog
CREATE TABLE IF NOT EXISTS call_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    call_sid TEXT NOT NULL,
    recording_sid TEXT,
    recording_url TEXT,
    duration INTEGER,
    call_direction TEXT NOT NULL CHECK(call_direction IN ('inbound', 'outbound')),
    caller_phone TEXT,
    status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing', 'ready', 'failed')),
    transcript TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, call_sid),
    UNIQUE(client_id, recording_sid),
    FOREIGN KEY(call_sid) REFERENCES call_logs(call_sid)
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_client_created_at ON call_recordings(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_recordings_client_call_sid ON call_recordings(client_id, call_sid);
CREATE INDEX IF NOT EXISTS idx_call_recordings_client_recording_sid ON call_recordings(client_id, recording_sid);
