-- Mission Control — agency-facing ops console schema.
--
-- Two kinds of change:
--   1. Business metadata on `tenants` that the agency tracks per client.
--   2. New agency-side tables (leads, tickets, operators, settings).
--
-- Security model: every new table has RLS enabled with NO policies.
-- Mission Control reads/writes exclusively through its own server on the
-- service-role key, gated by the `operators` table — nothing here is ever
-- visible to the anon key or to tenant console users.

-- ── tenants: agency-tracked business fields ─────────────────────────────
alter table tenants add column if not exists industry text;
alter table tenants add column if not exists owner_name text;
alter table tenants add column if not exists owner_email text;
alter table tenants add column if not exists address text;
alter table tenants add column if not exists trial_ends_at timestamptz;
-- Cached from Stripe for list views; Billing always reads Stripe live.
alter table tenants add column if not exists mrr_cents int;
-- Operator kill-switch: engine should route to voicemail when true.
alter table tenants add column if not exists ai_paused boolean not null default false;

-- ── leads: sales pipeline (kanban) ──────────────────────────────────────
create table if not exists leads (
  id bigint generated always as identity primary key,
  business text not null,
  owner_name text,
  industry text,
  note text,
  value_cents int,                        -- est. monthly plan value
  stage text not null default 'new',
    -- new | demo_scheduled | demo_completed | proposal_sent | won | lost
  phone text,
  email text,
  next_at timestamptz,                    -- demo date / follow-up
  tenant_id text references tenants(id),  -- linked once converted
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_leads_stage on leads (stage, updated_at desc);

-- ── tickets: support inbox ──────────────────────────────────────────────
create table if not exists tickets (
  id bigint generated always as identity primary key,
  tenant_id text references tenants(id),
  subject text not null,
  priority text not null default 'normal',  -- urgent | high | normal | low
  status text not null default 'open',      -- open | pending | resolved
  channel text default 'email',             -- email | phone | whatsapp
  linked_call_id text,                      -- audit_events.event_id, if any
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tickets_status on tickets (status, updated_at desc);

create table if not exists ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references tickets(id) on delete cascade,
  author text not null,                     -- display name
  is_operator boolean not null default false,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists idx_ticket_messages_ticket
  on ticket_messages (ticket_id, created_at);

-- ── operators: who may enter Mission Control ────────────────────────────
-- Membership here is the entire authorization check: the server resolves the
-- Supabase Auth session, then requires a row in this table.
create table if not exists operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  role text not null default 'operator',    -- owner | admin | operator
  created_at timestamptz default now()
);

-- ── workspace_settings: single-row agency config ────────────────────────
create table if not exists workspace_settings (
  id boolean primary key default true check (id),  -- enforces one row
  workspace_name text,                     -- overrides BRANDING defaults
  company_name text,
  region text default 'us-east',
  default_trial_days int default 14,
  plan_prices jsonb default '{"starter": 14900, "growth": 29900, "scale": 59900}',
  alerts jsonb default '{"payFail": true, "trialEnd": true, "aiDeg": true, "usage": false, "weekly": true}',
  updated_at timestamptz default now()
);

insert into workspace_settings (id) values (true) on conflict do nothing;

-- ── monthly MRR snapshots: Analytics growth chart ───────────────────────
-- Stripe has no cheap "MRR as of month X" API; Mission Control records a
-- snapshot whenever it computes MRR and the month rolls over.
create table if not exists mrr_snapshots (
  month date primary key,                  -- first of month
  mrr_cents int not null,
  active_subscriptions int,
  created_at timestamptz default now()
);

-- ── RLS: service-role only, everywhere ──────────────────────────────────
alter table leads enable row level security;
alter table tickets enable row level security;
alter table ticket_messages enable row level security;
alter table operators enable row level security;
alter table workspace_settings enable row level security;
alter table mrr_snapshots enable row level security;
-- No policies on purpose: RLS-on with zero policies means anon and
-- authenticated roles see nothing; the service-role key bypasses RLS.
