-- Mission Control operators: track actual onboarding completion.
--
-- Supabase's auth.users timestamps (email_confirmed_at, last_sign_in_at)
-- turned out to be the wrong signal for "has this operator actually set a
-- password and used the console" — both get set the moment ANY magic-link
-- style URL is clicked (invite, recovery, even a broken one), not when a
-- password is actually chosen. Track it ourselves instead.

alter table operators add column if not exists joined_at timestamptz;

-- Backfill: an operator whose row already has activity we can't verify one
-- way or the other stays NULL (pending) — it self-heals the next time they
-- successfully authenticate (see lib/server/operator.ts), which is the only
-- moment we can be sure they actually have working credentials.
