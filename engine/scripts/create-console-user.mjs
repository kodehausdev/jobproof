// Provision a console login for a lab (invitation-only model — the console
// has no public signup; accounts are created here during tenant onboarding).
//
//   node scripts/create-console-user.mjs <email> <tenant_id> [role]
//
// Uses the service-role key from ../.env. Creates the auth user (confirmed,
// no verification email) with a generated password, and links it to the
// tenant via a profiles row. Prints the credentials once — store them safely.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const [email, tenantId, role = "staff"] = process.argv.slice(2);
if (!email || !tenantId) {
  console.error("usage: node scripts/create-console-user.mjs <email> <tenant_id> [owner|staff]");
  process.exit(1);
}
if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_KEY missing in .env");
  process.exit(1);
}

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

const { data: tenant, error: tenantError } = await admin
  .from("tenants").select("id, lab_name").eq("id", tenantId).single();
if (tenantError || !tenant) {
  console.error(`tenant "${tenantId}" not found — create the tenants row first`);
  process.exit(1);
}

const password = randomBytes(15).toString("base64url");
const { data: created, error: userError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (userError) {
  console.error(`create user failed: ${userError.message}`);
  process.exit(1);
}

const { error: profileError } = await admin
  .from("profiles")
  .upsert({ user_id: created.user.id, tenant_id: tenantId, role });
if (profileError) {
  console.error(`profile link failed: ${profileError.message}`);
  process.exit(1);
}

console.log(`Console account for ${tenant.lab_name} (${tenantId})`);
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  role:     ${role}`);
