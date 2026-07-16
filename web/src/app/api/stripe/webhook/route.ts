// POST /api/stripe/webhook
// Subscription lifecycle sync. scripts/activate-tenant.mjs creates the
// subscription at go-live; this keeps tenants honest afterwards (past_due,
// canceled, reactivated). Requires STRIPE_WEBHOOK_SECRET (from
// `stripe listen` locally, or the dashboard endpoint config in production).
// Without it: 501, by design.

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { stripeClient } from "@/lib/server/stripe";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured." },
      { status: 501 }
    );

  const signature = req.headers.get("stripe-signature");
  if (!signature)
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "bad signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const admin = supabaseAdmin();

  async function setStatus(tenantId: string, status: string, subscriptionId?: string | null) {
    const patch: Record<string, string> = { subscription_status: status };
    if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
    await admin.from("tenants").update(patch).eq("id", tenantId);
  }

  switch (event.type) {
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        // Stripe statuses map 1:1 for our purposes; 'trialing' counts as active.
        const status =
          sub.status === "trialing" ? "active" : sub.status;
        await setStatus(tenantId, status, sub.id);
      }
      break;
    }
    default:
      break; // unhandled event types are fine
  }

  return NextResponse.json({ received: true });
}
