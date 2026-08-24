import "server-only";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const json = Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json);
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

// Fail loudly at module load if SUPABASE_SERVICE_ROLE_KEY isn't actually a
// service_role key. This catches the anon-key-pasted-by-mistake case at
// startup instead of surfacing as a confusing RLS error at request time.
if (serviceKey) {
  const role = decodeJwtRole(serviceKey);
  if (role !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY does not look like a service_role key ` +
        `(decoded role: "${role ?? "unknown"}"). Check that you copied the ` +
        `service_role secret from Project Settings > API, not the anon/public key.`
    );
  }
}

export function supabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not configured"
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}