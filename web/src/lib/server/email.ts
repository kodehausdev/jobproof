// Transactional email via Resend, sent directly by the Jobproof web console instead of
// relying on Supabase Auth's built-in mailer — that mailer is rate limited
// and was unreliable in practice for real invite/reset delivery (see
// mission-control/src/lib/server/operator.ts and .../email.ts, where this
// exact problem showed up first). Same pattern, adapted here: a plain POST
// to the Resend API, no SDK.

import "server-only";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM ?? "Jobproof <notifications@jobproof.ai>";

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

// Interpolating raw values (the Supabase action link especially — its query
// string has unescaped `&` separating token/type/redirect_to) straight into
// HTML broke real invite links on at least one mobile mail client in
// mission-control. Escape everything that lands in the template.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(preheader: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <span style="display:none;font-size:1px;color:#f1f5f9;">${preheader}</span>
  <table role="presentation" width="100%" style="max-width:420px;margin:0 auto;">
    <tr><td style="padding-bottom:22px;">
      <span style="display:inline-flex;align-items:center;gap:9px;">
        <span style="display:inline-block;width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;font-weight:700;font-size:13px;line-height:26px;text-align:center;">J</span>
        <span style="color:#0f172a;font-weight:600;font-size:14px;">Jobproof</span>
      </span>
    </td></tr>
    <tr><td style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px 24px;">
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding-top:18px;color:#94a3b8;font-size:11px;">
      If you weren't expecting this email, you can ignore it.
    </td></tr>
  </table>
</body>
</html>`;
}

export function teamInviteEmail(actionLink: string, labName: string) {
  const safeLink = escapeHtml(actionLink);
  const safeName = escapeHtml(labName);
  const html = shell(
    `You've been invited to ${safeName}`,
    `<p style="color:#0f172a;font-size:15px;font-weight:600;margin:0 0 8px;">You're invited to ${safeName}</p>
     <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 20px;">
       Someone on the team added you to the Jobproof console.
       Click below to set your password and get in.
     </p>
     <a href="${safeLink}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">
       Accept invite &amp; set password
     </a>
     <p style="color:#94a3b8;font-size:11px;margin:20px 0 0;">This link expires soon and can only be used once.</p>`
  );
  const text = `You're invited to ${labName} on the Jobproof console.\n\nAccept your invite: ${actionLink}\n\nThis link expires soon and can only be used once.`;
  return { html, text };
}

export function teamAccessLinkEmail(actionLink: string, labName: string) {
  const safeLink = escapeHtml(actionLink);
  const safeName = escapeHtml(labName);
  const html = shell(
    `Set your ${safeName} password`,
    `<p style="color:#0f172a;font-size:15px;font-weight:600;margin:0 0 8px;">Set your password</p>
     <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 20px;">
       You have an account on ${safeName}'s console, but no password set yet.
       Click below to choose one and get in.
     </p>
     <a href="${safeLink}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#2563eb);color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;">
       Set password &amp; continue
     </a>
     <p style="color:#94a3b8;font-size:11px;margin:20px 0 0;">This link expires soon and can only be used once.</p>`
  );
  const text = `Set your password for ${labName} on the Jobproof console.\n\n${actionLink}\n\nThis link expires soon and can only be used once.`;
  return { html, text };
}
