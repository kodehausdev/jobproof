// GET /api/team/members
// Lists everyone linked to the caller's tenant. Server-only: the "read own
// profile" RLS policy on profiles deliberately only lets a user read their
// own row, not their teammates' — so this has to go through the service
// role like every other cross-row read.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

export async function GET(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const admin = supabaseAdmin();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, role, created_at, joined_at")
    .eq("tenant_id", result.tenant.id)
    .order("created_at", { ascending: true });
  if (error)
    return NextResponse.json({ error: `Could not load team: ${error.message}` }, { status: 500 });

  const members = await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.user_id);
      return {
        user_id: p.user_id,
        role: p.role,
        created_at: p.created_at,
        email: data?.user?.email ?? "(unknown)",
        // Not auth.users' email_confirmed_at — that flips on any clicked
        // magic-link (invite, recovery, even a broken one), whether or not
        // a password was ever set. joined_at is stamped lazily, only on a
        // real authenticated resolution (see session.ts).
        invite_pending: !p.joined_at,
      };
    })
  );

  return NextResponse.json({ members, callerUserId: result.caller.userId, callerRole: result.caller.role });
}
