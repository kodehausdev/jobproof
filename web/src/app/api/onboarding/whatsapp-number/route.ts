// POST /api/onboarding/whatsapp-number  { whatsapp_number, confirmed_unregistered }
// Self-serve number intake, rendered by <NumberIntake> while the tenant is
// 'provisioning_pending_number'. Advances to 'provisioning_active' — ops
// then configures Twilio + the engine for this tenant out of band, and
// runs scripts/activate-tenant.mjs once it's live.
//
// confirmed_unregistered is a self-attestation, not a verified check — there's
// no API we call here to confirm it. WhatsApp Business registration itself
// will reject a number that already has (or had) a personal/Business app
// account, so this just front-loads that failure mode before ops spends time
// on it, rather than catching it for real.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const E164_RE = /^\+[1-9]\d{7,14}$/;

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const { tenant } = result;
  if (tenant.onboarding_state !== "provisioning_pending_number")
    return NextResponse.json(
      { error: `Tenant isn't awaiting a number (${tenant.onboarding_state}).` },
      { status: 409 }
    );

  let whatsappNumber: string | undefined;
  let confirmedUnregistered: boolean | undefined;
  try {
    const body = await req.json();
    whatsappNumber = body?.whatsapp_number;
    confirmedUnregistered = body?.confirmed_unregistered;
  } catch {
    /* fall through */
  }
  whatsappNumber = whatsappNumber?.trim();
  if (!whatsappNumber || !E164_RE.test(whatsappNumber))
    return NextResponse.json(
      { error: "Enter the number in international format, e.g. +14155551234." },
      { status: 400 }
    );
  if (confirmedUnregistered !== true)
    return NextResponse.json(
      { error: "Confirm the number has no existing WhatsApp registration before submitting." },
      { status: 400 }
    );

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({ whatsapp_number: whatsappNumber, onboarding_state: "provisioning_active" })
    .eq("id", tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not save number: ${error.message}` }, { status: 500 });

  return NextResponse.json({ onboarding_state: "provisioning_active" });
}
