// The "provisioning complete" trigger — run by ops once a tenant's
// WhatsApp number is verified and the engine is actually configured for
// them. Creates the real $297/mo subscription (this is the moment the card
// on file is actually charged) and flips the tenant to 'live_active'.
//
//   node scripts/activate-tenant.mjs <tenant_id>
//
// Uses the service-role key + Stripe secret key from ../.env.local.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const [tenantId] = process.argv.slice(2);
if (!tenantId) {
  console.error("usage: node scripts/activate-tenant.mjs <tenant_id>");
  process.exit(1);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
  console.error("STRIPE_SECRET_KEY / STRIPE_PRICE_ID missing in .env.local");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const { data: tenant, error: tenantError } = await admin
  .from("tenants")
  .select("id, lab_name, onboarding_state, stripe_customer_id, stripe_payment_method_id")
  .eq("id", tenantId)
  .single();
if (tenantError || !tenant) {
  console.error(`tenant "${tenantId}" not found`);
  process.exit(1);
}
if (tenant.onboarding_state !== "provisioning_active") {
  console.error(
    `tenant is "${tenant.onboarding_state}", not "provisioning_active" — nothing to activate`
  );
  process.exit(1);
}
if (!tenant.stripe_customer_id || !tenant.stripe_payment_method_id) {
  console.error("tenant has no card on file — the $0 setup step never completed");
  process.exit(1);
}

const subscription = await stripe.subscriptions.create({
  customer: tenant.stripe_customer_id,
  items: [{ price: env.STRIPE_PRICE_ID }],
  default_payment_method: tenant.stripe_payment_method_id,
  metadata: { tenant_id: tenant.id },
});

const { error: updateError } = await admin
  .from("tenants")
  .update({
    subscription_status: subscription.status === "trialing" ? "active" : subscription.status,
    stripe_subscription_id: subscription.id,
    onboarding_state: "live_active",
  })
  .eq("id", tenant.id);
if (updateError) {
  console.error(`subscription created (${subscription.id}) but tenant update failed: ${updateError.message}`);
  process.exit(1);
}

console.log(`${tenant.lab_name} (${tenant.id}) is live.`);
console.log(`  subscription: ${subscription.id} (${subscription.status})`);
