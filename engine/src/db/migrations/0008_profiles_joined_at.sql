-- medlab-web team invites: track actual onboarding completion.
--
-- Same fix as migrations/0007_operators_joined_at.sql for mission-control's
-- operators table. Supabase's auth.users timestamps (email_confirmed_at,
-- last_sign_in_at) are the wrong signal for "has this teammate actually set
-- a password and used the console" — both flip the moment ANY magic-link
-- style URL is clicked (invite, recovery, even a broken one), not when a
-- password is actually chosen. Track it ourselves instead.

alter table profiles add column if not exists joined_at timestamptz;

-- Backfill: existing profiles stay NULL (pending) — self-heals the next
-- time each of those users successfully authenticates (see
-- medlab-web/src/lib/server/session.ts), the only moment we can be sure
-- they actually have working credentials.
