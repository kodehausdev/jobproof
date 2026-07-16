// POST /api/billing/portal-session
// Creates a Stripe Billing Portal session for the signed-in tenant's
// customer and returns the URL to redirect to. The portal itself handles
// invoices, card updates, and cancellation — no need to build those
// screens ourselves.

import { NextResponse } from "next/server";
import { getCallerTenant } from "@/lib/server/session";
import { stripeClient } from "@/lib/server/stripe";

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const { tenant } = result;
  if (!tenant.stripe_customer_id)
    return NextResponse.json(
      { error: "No billing account on file yet for this lab." },
      { status: 409 }
    );

  const stripe = stripeClient();
  const origin = new URL(req.url).origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripe_customer_id,
    return_url: `${origin}/billing`,
  });

  return NextResponse.json({ url: session.url });
}
