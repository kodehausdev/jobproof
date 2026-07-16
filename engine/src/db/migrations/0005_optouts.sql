-- TCPA/CTIA opt-out registry. A STOP-keyword message on WhatsApp is honored
-- deterministically (never routed through the model) and recorded here per
-- (tenant, phone). The engine suppresses ALL outbound sends to opted-out
-- numbers; START/UNSTOP flips it back.

create table if not exists optouts (
  tenant_id text not null references tenants(id),
  phone_number text not null,             -- normalized, no 'whatsapp:' prefix
  opted_out boolean not null default true,
  updated_at timestamptz default now(),
  primary key (tenant_id, phone_number)
);

-- Engine-only table: written and read with the service-role key.
-- RLS on with no policies = invisible to console users and the anon key.
alter table optouts enable row level security;
