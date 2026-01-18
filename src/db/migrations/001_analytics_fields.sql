-- Add booked flag to call_logs for easier analytics
ALTER TABLE call_logs ADD COLUMN is_booked INTEGER DEFAULT 0;
-- Add service_type to voicemails
ALTER TABLE voicemails ADD COLUMN service_type TEXT;
