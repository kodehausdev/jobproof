-- 0003 — Billing linkage for self-serve onboarding.
-- Tenants created by the signup wizard start 'incomplete' and flip to
-- 'active' when Stripe confirms the subscription (success-page verification
-- and/or webhook). The engine only serves tenants; the console only shows
-- them — enforcement of status comes with the multi-tenant engine milestone.

alter table tenants add column if not exists stripe_customer_id text;
alter table tenants add column if not exists stripe_subscription_id text;
alter table tenants add column if not exists subscription_status text default 'incomplete';

-- Existing hand-provisioned tenants predate billing — treat them as active.
update tenants set subscription_status = 'active' where subscription_status = 'incomplete';
