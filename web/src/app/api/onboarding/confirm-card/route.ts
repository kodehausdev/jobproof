// POST /api/onboarding/confirm-card  { setup_intent_id }
// Called by <PaymentGate> after Stripe confirms the SetupIntent client-side
// (never trusts that alone — re-verifies server-side). Saves the resulting
// payment method as the customer's default and advances the tenant to
// 'provisioning_pending_number'. Idempotent — safe to call twice.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";
import { stripeClient } from "@/lib/server/stripe";

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const { tenant } = result;
  if (tenant.onboarding_state !== "payment_pending")
    return NextResponse.json({ onboarding_state: tenant.onboarding_state });

  let setupIntentId: string | undefined;
  try {
    setupIntentId = (await req.json())?.setup_intent_id;
  } catch {
    /* fall through */
  }
  if (!setupIntentId)
    return NextResponse.json({ error: "setup_intent_id is required." }, { status: 400 });

  const stripe = stripeClient();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

  if (setupIntent.metadata?.tenant_id !== tenant.id)
    return NextResponse.json({ error: "Unknown setup intent." }, { status: 404 });
  if (setupIntent.status !== "succeeded")
    return NextResponse.json(
      { error: "Card was not confirmed yet.", status: setupIntent.status },
      { status: 402 }
    );

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;
  if (!paymentMethodId)
    return NextResponse.json({ error: "SetupIntent has no payment method." }, { status: 500 });

  await stripe.customers.update(tenant.stripe_customer_id!, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({
      stripe_payment_method_id: paymentMethodId,
      onboarding_state: "provisioning_pending_number",
    })
    .eq("id", tenant.id);
  if (error)
    return NextResponse.json({ error: `Activation failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ onboarding_state: "provisioning_pending_number" });
}
