// POST /api/team/invite  { email, role }
// Owner-only. Sends its own email via Resend instead of letting Supabase's
// built-in mailer handle it — that mailer is rate-limited and was
// unreliable in practice (see mission-control/src/lib/server/operator.ts
// and .../email.ts, where this exact problem showed up first).
// generateLink() only ever returns a token; it never sends anything.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";
import { sendEmail, teamAccessLinkEmail, teamInviteEmail } from "@/lib/server/email";

const VALID_ROLES = new Set(["owner", "staff"]);

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.caller.role !== "owner")
    return NextResponse.json({ error: "Only an owner can invite teammates." }, { status: 403 });

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const role = body.role ?? "staff";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!VALID_ROLES.has(role))
    return NextResponse.json({ error: "Role must be 'owner' or 'staff'." }, { status: 400 });

  const admin = supabaseAdmin();
  const origin = new URL(req.url).origin;
  const redirectTo = `${origin}/accept-invite`;

  let userId: string | null = null;
  let emailAction: "invited" | "reset-sent" | "already-joined" = "invited";
  let actionLink: string | null = null;

  const { data: inviteLink, error: inviteError } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (inviteLink?.user) {
    userId = inviteLink.user.id;
    actionLink = inviteLink.properties.action_link;
  } else {
    // generateLink({type:'invite'}) refuses once *any* auth account exists
    // for this email — including a stale, never-completed one. Link the
    // existing account instead, and if they've never actually finished
    // joining (no profile row on THIS tenant, or joined_at unset), send a
    // real recovery link rather than silently doing nothing.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (!userId)
      return NextResponse.json({ error: `Invite failed: ${inviteError?.message}` }, { status: 500 });

    const { data: existingProfile } = await admin
      .from("profiles")
      .select("joined_at, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingProfile?.joined_at && existingProfile.tenant_id === result.tenant.id) {
      emailAction = "already-joined";
    } else {
      const { data: recoveryLink, error: recoveryError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (recoveryError || !recoveryLink)
        return NextResponse.json(
          { error: `Could not generate access link: ${recoveryError?.message}` },
          { status: 500 }
        );
      actionLink = recoveryLink.properties.action_link;
      emailAction = "reset-sent";
    }
  }

  if (actionLink) {
    const { html, text } =
      emailAction === "invited"
        ? teamInviteEmail(actionLink, result.tenant.lab_name)
        : teamAccessLinkEmail(actionLink, result.tenant.lab_name);
    const sent = await sendEmail({
      to: email,
      subject:
        emailAction === "invited"
          ? `You're invited to ${result.tenant.lab_name}`
          : `Set your ${result.tenant.lab_name} password`,
      html,
      text,
    });
    if (!sent.ok)
      return NextResponse.json({ error: `Email failed to send: ${sent.error}` }, { status: 502 });
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ user_id: userId, tenant_id: result.tenant.id, role });
  if (profileError)
    return NextResponse.json(
      { error: `Could not link invited account: ${profileError.message}` },
      { status: 500 }
    );

  const messages = {
    invited: `Invite email sent to ${email}.`,
    "reset-sent": `${email} had a stale account — sent a fresh access-link email instead.`,
    "already-joined": `${email} already has access — role updated to ${role}.`,
  };
  return NextResponse.json({ ok: true, message: messages[emailAction] });
}
