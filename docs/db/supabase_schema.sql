-- SUPABASE SCHEMA DESIGN FOR AI-RECEPTIONIST

-- 1. Clients Table
CREATE TABLE clients (
  id TEXT PRIMARY KEY, -- Using slug/id from SQLite
  clerk_user_id TEXT UNIQUE NOT NULL,
  business_name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Call Logs
CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  call_sid TEXT UNIQUE NOT NULL,
  caller_phone TEXT,
  call_direction TEXT CHECK (call_direction IN ('inbound', 'outbound')),
  call_status TEXT,
  call_duration INTEGER,
  intent_detected TEXT,
  conversation_summary TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Conversation Turns
CREATE TABLE conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT REFERENCES call_logs(call_sid) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- 4. Voicemails
CREATE TABLE voicemails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT REFERENCES call_logs(call_sid) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  recording_url TEXT,
  transcription_text TEXT,
  duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Client Metrics
CREATE TABLE client_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- ROW LEVEL SECURITY (RLS) POLICIES

-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE voicemails ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_metrics ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's client_id
-- Assumes auth.uid() in Supabase is mapped to Clerk's user_id (text)
CREATE OR REPLACE FUNCTION get_current_client_id()
RETURNS TEXT AS $$
  SELECT id FROM clients WHERE clerk_user_id = auth.uid()::text;
$$ LANGUAGE sql STABLE;

-- Clients Policies
CREATE POLICY "Users can see their own client data"
  ON clients FOR SELECT
  USING (clerk_user_id = auth.uid()::text);

-- Call Logs Policies
CREATE POLICY "Clients can see their own call logs"
  ON call_logs FOR SELECT
  USING (client_id = get_current_client_id());

-- Conversation Turns Policies
-- Access via join or subquery on call_sid
CREATE POLICY "Clients can see their own conversation turns"
  ON conversation_turns FOR SELECT
  USING (
    call_sid IN (
      SELECT call_sid FROM call_logs WHERE client_id = get_current_client_id()
    )
  );

-- Voicemails Policies
CREATE POLICY "Clients can see their own voicemails"
  ON voicemails FOR SELECT
  USING (client_id = get_current_client_id());

-- Client Metrics Policies
CREATE POLICY "Clients can see their own metrics"
  ON client_metrics FOR SELECT
  USING (client_id = get_current_client_id());

-- ADMIN POLICIES (Assuming an 'admin' role or specific IDs)
-- For simplicity, let's say admins have a specific metadata flag in Clerk/Supabase
-- Or we can add an is_admin flag to a profiles table.
