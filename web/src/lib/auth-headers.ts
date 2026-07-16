// Shared helper for onboarding API calls made from the console: attaches
// the signed-in user's Supabase access token so the server can resolve
// their tenant (see lib/server/session.ts's getCallerTenant).

import { supabase } from "@/lib/supabase";

export async function authHeaders(): Promise<Record<string, string>> {
  const sb = supabase;
  if (!sb) return { "Content-Type": "application/json" };
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
