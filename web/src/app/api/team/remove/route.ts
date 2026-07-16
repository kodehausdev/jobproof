// POST /api/team/remove  { user_id }
// Owner-only. Deletes the profiles row (revokes tenant access via
// user_tenant_id()) — deliberately does NOT delete the underlying auth
// user, since that account may have nothing to do with this tenant beyond
// membership and fully deleting someone's login is a heavier action than
// "remove from this team."

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.caller.role !== "owner")
    return NextResponse.json({ error: "Only an owner can remove teammates." }, { status: 403 });

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const userId = body.user_id;
  if (!userId) return NextResponse.json({ error: "user_id is required." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", result.tenant.id)
    .single();
  if (targetError || !target)
    return NextResponse.json({ error: "That person isn't on this team." }, { status: 404 });

  if (target.role === "owner") {
    const { count } = await admin
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", result.tenant.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1)
      return NextResponse.json(
        { error: "Can't remove the last owner — promote someone else first." },
        { status: 409 }
      );
  }

  const { error } = await admin
    .from("profiles")
    .delete()
    .eq("user_id", userId)
    .eq("tenant_id", result.tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not remove: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
