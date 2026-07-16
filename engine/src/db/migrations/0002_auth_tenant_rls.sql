-- 0002 — Auth + tenant-scoped RLS.
-- Run this in the Supabase SQL editor on a database that already ran the
-- original schema.sql (which shipped permissive dev read policies).
--
-- After this migration:
--   · anon key      → no rows, anywhere
--   · authenticated → rows for their own tenant only (via profiles mapping)
--   · service role  → unrestricted (the engine's write path, bypasses RLS)

-- 1. Map auth users to tenants. A console login belongs to exactly one lab.
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id text not null references tenants(id),
  role text not null default 'staff',     -- 'owner' | 'staff'
  created_at timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 2. Helper: the caller's tenant. SECURITY DEFINER so policy evaluation on
-- other tables doesn't recurse into profiles' own RLS.
create or replace function public.user_tenant_id()
returns text
language sql stable security definer
set search_path = public
as $$
  select tenant_id from profiles where user_id = auth.uid()
$$;

revoke execute on function public.user_tenant_id() from anon;

-- 3. Replace the dev posture with tenant-scoped reads.
drop policy if exists "dev read tenants" on tenants;
drop policy if exists "dev read appointments" on appointments;
drop policy if exists "dev read audit_events" on audit_events;

create policy "tenant members read their tenant" on tenants
  for select to authenticated
  using (id = public.user_tenant_id());

create policy "tenant members read their appointments" on appointments
  for select to authenticated
  using (tenant_id = public.user_tenant_id());

create policy "tenant members read their audit trail" on audit_events
  for select to authenticated
  using (tenant_id = public.user_tenant_id());

-- No insert/update/delete policies on purpose: the console is read-only;
-- all writes go through the engine on the service role.
