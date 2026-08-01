// POST /api/settings/update
//   { lab_name, timezone, open_hour, close_hour, slot_capacity, notify_phone }
// Self-serve edit of the tenant-level fields that already exist in the
// schema and directly drive engine behavior (buildDaySlots, countBookings,
// notifyOwner). Test-type catalog isn't here — it's still hardcoded
// engine-side, not a per-tenant DB setting yet.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";
import { US_TIMEZONE_VALUES } from "@/lib/timezones";

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const labName = typeof body.lab_name === "string" ? body.lab_name.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "";
  const openHour = Number(body.open_hour);
  const closeHour = Number(body.close_hour);
  const slotCapacity = Number(body.slot_capacity);
  const notifyPhoneRaw = typeof body.notify_phone === "string" ? body.notify_phone.trim() : "";

  if (!labName || labName.length > 120)
    return NextResponse.json({ error: "Business name is required (max 120 characters)." }, { status: 400 });
  if (!US_TIMEZONE_VALUES.includes(timezone as (typeof US_TIMEZONE_VALUES)[number]))
    return NextResponse.json({ error: "Unrecognized timezone." }, { status: 400 });
  if (!Number.isInteger(openHour) || !Number.isInteger(closeHour) || openHour < 0 || closeHour > 23 || openHour >= closeHour)
    return NextResponse.json({ error: "Open hour must be before close hour, both within 0–23." }, { status: 400 });
  if (!Number.isInteger(slotCapacity) || slotCapacity < 1 || slotCapacity > 20)
    return NextResponse.json({ error: "Jobs per slot must be between 1 and 20." }, { status: 400 });
  // Empty clears/disables owner notifications; otherwise a loose phone-shaped
  // sanity check — Twilio is the actual source of truth on deliverability.
  if (notifyPhoneRaw && !/^\+?[0-9\s\-().]{7,20}$/.test(notifyPhoneRaw))
    return NextResponse.json({ error: "Notification phone doesn't look like a valid number." }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({
      lab_name: labName,
      timezone,
      open_hour: openHour,
      close_hour: closeHour,
      slot_capacity: slotCapacity,
      notify_phone: notifyPhoneRaw || null,
    })
    .eq("id", result.tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not save settings: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
