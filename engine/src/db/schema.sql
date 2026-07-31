-- Jobproof — Supabase schema
-- Deliberately minimal: the appointments table holds the ONLY customer data
-- this system stores. No transcripts, no free-text notes, no payment fields.

create table if not exists tenants (
  id text primary key,                    -- e.g. 'default' or a slug
  lab_name text not null,
  twilio_number text,                     -- inbound voice number → tenant routing
  whatsapp_number text,                   -- inbound WA sender → tenant routing
  timezone text default 'America/New_York',
  open_hour int default 8,
  close_hour int default 17,
  slot_capacity int default 2,
  plan text default 'standard',           -- $297/mo standard
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text default 'incomplete',  -- incomplete | active | past_due | canceled
  stripe_payment_method_id text,          -- default PM saved at the $0 setup step
  onboarding_state text not null default 'live_active',
    -- payment_pending | provisioning_pending_number | provisioning_active | live_active
    -- self-serve signup starts at payment_pending; hand-provisioned/legacy
    -- tenants default straight to live_active (see migrations/0004)
  created_at timestamptz default now()
);

-- Single-tenant MVP seed — matches the .env defaults. Multi-tenant onboarding
-- replaces this with real rows keyed by inbound Twilio number.
insert into tenants (id, lab_name)
  values ('default', 'Ironclad Home Services')
  on conflict (id) do nothing;

create table if not exists appointments (
  id bigint generated always as identity primary key,
  tenant_id text references tenants(id),
  patient_name text not null,
  phone_number text not null,
  test_type text not null,
  date date not null,
  time_slot text not null,                -- 'HH:MM' 24h
  channel text not null,                  -- 'voice' | 'sms' | 'whatsapp'
  status text default 'confirmed',        -- confirmed | cancelled | completed
  created_at timestamptz default now()
);

create index if not exists idx_appointments_slot
  on appointments (tenant_id, date, time_slot) where status = 'confirmed';

-- TCPA/CTIA opt-out registry: STOP keywords honored deterministically
-- (never routed through the model), recorded per (tenant, phone). The
-- engine suppresses all outbound sends to opted-out numbers.
-- (Existing databases: apply migrations/0005_optouts.sql instead.)
create table if not exists optouts (
  tenant_id text not null references tenants(id),
  phone_number text not null,             -- normalized, no 'whatsapp:' prefix
  opted_out boolean not null default true,
  updated_at timestamptz default now(),
  primary key (tenant_id, phone_number)
);

-- Audit log: the durable copy of the dashboard event stream
-- (services/events.js envelope). PHI-minimized at the source — phone numbers
-- reduced to a 4-digit tail, guardrail events carry no caller content.
create table if not exists audit_events (
  id bigint generated always as identity primary key,
  tenant_id text,
  event_id text,                          -- engine envelope id ('evt-7', per-process)
  type text not null,                     -- 'call.answered' | 'booking.confirmed' | 'guardrail.redacted'
  channel text default 'unknown',         -- 'voice' | 'sms' | 'whatsapp'
  phone_tail text,                        -- last 4 digits only
  data jsonb default '{}',                -- type-specific, whitelisted fields only
  created_at timestamptz default now()
);

create index if not exists idx_audit_events_tenant_time
  on audit_events (tenant_id, created_at desc);

-- Console realtime: stream INSERTs to subscribed dashboards.
alter publication supabase_realtime add table audit_events;

-- ── Auth + row-level security ─────────────────────────────────
-- The engine writes with the service-role key (bypasses RLS). Console users
-- sign in with Supabase Auth and read only their own tenant's rows via the
-- profiles mapping below. The anon key can read nothing.
-- (Existing databases: apply migrations/0002_auth_tenant_rls.sql instead.)

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text not null references tenants(id),
  role text not null default 'staff',     -- 'owner' | 'staff'
  created_at timestamptz default now(),
  -- Stamped lazily on first successful authenticated resolution, not by
  -- Supabase's auth.users timestamps — those flip on any clicked
  -- magic-link (invite, recovery, even a broken one), whether or not a
  -- password was ever actually set. See migrations/0008 for the same
  -- reasoning applied to mission-control's operators table first.
  joined_at timestamptz
);

create or replace function public.user_tenant_id()
returns text
language sql stable security definer
set search_path = public
as $$
  select tenant_id from profiles where user_id = auth.uid()
$$;

revoke execute on function public.user_tenant_id() from anon;

alter table tenants enable row level security;
alter table appointments enable row level security;
alter table audit_events enable row level security;
alter table profiles enable row level security;
-- optouts: engine-only (service role). RLS on with no policies = invisible
-- to console users and the anon key.
alter table optouts enable row level security;

create policy "read own profile" on profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "tenant members read their tenant" on tenants
  for select to authenticated using (id = public.user_tenant_id());
create policy "tenant members read their appointments" on appointments
  for select to authenticated using (tenant_id = public.user_tenant_id());
create policy "tenant members read their audit trail" on audit_events
  for select to authenticated using (tenant_id = public.user_tenant_id());

-- No insert/update/delete policies on purpose: the console is read-only;
-- all writes go through the engine on the service role.
