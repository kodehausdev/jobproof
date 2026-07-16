-- 0004 — Multi-tenant engine routing.
-- The engine resolves the tenant from the inbound Twilio `To` number:
--   voice     → tenants.twilio_number
--   whatsapp  → tenants.whatsapp_number (sender, without the whatsapp: prefix)
-- Unmatched numbers fall back to the engine's env-configured default tenant.

alter table tenants add column if not exists whatsapp_number text;

-- Current dev numbers → BrightPath (the env default until now).
update tenants
   set twilio_number  = '+19383485842',
       whatsapp_number = '+14155238886'
 where id = 'default';
