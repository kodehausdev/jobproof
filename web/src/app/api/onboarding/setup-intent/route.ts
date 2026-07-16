// POST /api/onboarding/setup-intent
// Creates the $0 SetupIntent that collects a card on file for a tenant
// sitting in 'payment_pending'. No charge — the card is only used later,
// off-session, when ops activates the real subscription
// (scripts/activate-tenant.mjs). Consumed by <PaymentGate> via Stripe
// Elements' PaymentElement.

import { NextResponse } from "next/server";
import { getCallerTenant } from "@/lib/server/session";
import { stripeClient } from "@/lib/server/stripe";

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const { tenant } = result;
  if (tenant.onboarding_state !== "payment_pending")
    return NextResponse.json(
      { error: `Tenant is already past payment (${tenant.onboarding_state}).` },
      { status: 409 }
    );
  if (!tenant.stripe_customer_id)
    return NextResponse.json({ error: "No Stripe customer on this tenant." }, { status: 500 });

  const stripe = stripeClient();
  const setupIntent = await stripe.setupIntents.create({
    customer: tenant.stripe_customer_id,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { tenant_id: tenant.id },
  });

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
