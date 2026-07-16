// POST /api/team/role  { user_id, role }
// Owner-only. Same last-owner guard as remove — can't demote the only
// owner, since that would lock everyone out of owner-only actions
// (inviting, removing, billing) with no way back in short of a DB edit.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const VALID_ROLES = new Set(["owner", "staff"]);

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.caller.role !== "owner")
    return NextResponse.json({ error: "Only an owner can change roles." }, { status: 403 });

  let body: { user_id?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const userId = body.user_id;
  const role = body.role;
  if (!userId || !role || !VALID_ROLES.has(role))
    return NextResponse.json({ error: "user_id and a valid role are required." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", result.tenant.id)
    .single();
  if (targetError || !target)
    return NextResponse.json({ error: "That person isn't on this team." }, { status: 404 });

  if (target.role === "owner" && role !== "owner") {
    const { count } = await admin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", result.tenant.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1)
      return NextResponse.json(
        { error: "Can't demote the last owner — promote someone else first." },
        { status: 409 }
      );
  }

  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("user_id", userId)
    .eq("tenant_id", result.tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not update role: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
