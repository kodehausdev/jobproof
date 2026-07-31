// POST /api/onboarding/start
// Wizard steps 1–2 land here: provisions tenant (onboarding_state
// 'payment_pending') + owner account, and a Stripe customer to attach a
// card to later. No charge and no subscription yet — the tenant secures a
// card ($0 SetupIntent, /api/onboarding/setup-intent + confirm-card) after
// signing in, then self-serves a WhatsApp number, then ops activates the
// real $297/mo subscription once provisioning is done
// (scripts/activate-tenant.mjs).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { stripeClient } from "@/lib/server/stripe";

interface StartBody {
  labName?: string;
  timezone?: string;
  openHour?: number;
  closeHour?: number;
  slotCapacity?: number;
  email?: string;
  password?: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "lab"}-${suffix}`;
}

export async function POST(req: Request) {
  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const labName = body.labName?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const timezone = body.timezone || "America/New_York";
  const openHour = Number(body.openHour ?? 8);
  const closeHour = Number(body.closeHour ?? 17);
  const slotCapacity = Number(body.slotCapacity ?? 2);

  if (!labName || labName.length < 2)
    return NextResponse.json({ error: "Lab name is required." }, { status: 400 });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  if (!(openHour >= 0 && closeHour <= 24 && openHour < closeHour))
    return NextResponse.json({ error: "Opening hours are invalid." }, { status: 400 });
  if (!(slotCapacity >= 1 && slotCapacity <= 12))
    return NextResponse.json({ error: "Jobs per slot must be between 1 and 12." }, { status: 400 });

  const admin = supabaseAdmin();
  const stripe = stripeClient();
  const tenantId = slugify(labName);

  // 1. Tenant, pending payment.
  const { error: tenantError } = await admin.from("tenants").insert({
    id: tenantId,
    lab_name: labName,
    timezone,
    open_hour: openHour,
    close_hour: closeHour,
    slot_capacity: slotCapacity,
    plan: "standard",
    subscription_status: "incomplete",
    onboarding_state: "payment_pending",
  });
  if (tenantError)
    return NextResponse.json(
      { error: `Could not create tenant: ${tenantError.message}` },
      { status: 500 }
    );

  const rollback = async () => {
    await admin.from("tenants").delete().eq("id", tenantId);
  };

  // 2. Owner account (confirmed — no verification email in sandbox).
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !created?.user) {
    await rollback();
    const exists = /already/i.test(userError?.message ?? "");
    return NextResponse.json(
      {
        error: exists
          ? "An account with this email already exists. Sign in instead."
          : `Could not create account: ${userError?.message}`,
      },
      { status: exists ? 409 : 500 }
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    user_id: created.user.id,
    tenant_id: tenantId,
    role: "owner",
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await rollback();
    return NextResponse.json(
      { error: `Could not link account: ${profileError.message}` },
      { status: 500 }
    );
  }

  // 3. Stripe customer — the card itself is collected later via
  // /api/onboarding/setup-intent once the owner is signed in.
  try {
    const customer = await stripe.customers.create({
      email,
      name: labName,
      metadata: { tenant_id: tenantId },
    });
    await admin
      .from("tenants")
      .update({ stripe_customer_id: customer.id })
      .eq("id", tenantId);

    return NextResponse.json({ tenantId });
  } catch (err) {
    await admin.auth.admin.deleteUser(created.user.id);
    await rollback();
    const message = err instanceof Error ? err.message : "Stripe error";
    return NextResponse.json(
      { error: `Payment setup failed: ${message}` },
      { status: 502 }
    );
  }
}
