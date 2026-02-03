-- Client Registry (NO sensitive data)
-- This table stores basic client information for runtime management
-- Sensitive data (credentials, appointments, calls) stays in per-client databases

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT CHECK(status IN ('active', 'suspended', 'trial')) DEFAULT 'active',
  config_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_number);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
