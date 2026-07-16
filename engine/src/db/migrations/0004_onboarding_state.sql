-- 0004 — $0-today / $297-at-go-live onboarding.
-- Card-on-file is now captured before a subscription exists (a SetupIntent,
-- no charge). The real $297/mo subscription is created later, once
-- provisioning is confirmed complete — see medlab-web/scripts/activate-tenant.mjs.

alter table tenants add column if not exists stripe_payment_method_id text;

-- Existing tenants predate this flow entirely (hand-provisioned or already
-- billing) — the NOT NULL DEFAULT backfills every existing row to
-- 'live_active' as it's added, same intent 0003 had for subscription_status.
alter table tenants add column if not exists onboarding_state text not null default 'live_active';
