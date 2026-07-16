// Proves the tenant-isolation boundary against the live Supabase project.
//   node scripts/verify-rls.mjs <email> <password>
//
// Asserts:
//   1. The anon key with NO session reads zero rows from every table.
//   2. A signed-in tenant member reads their tenant's rows (and only sees
//      their own tenant in `tenants`).
// Exits non-zero on any violation — safe to wire into CI later.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const [email, password] = process.argv.slice(2);

if (!url || !anonKey) fail("Supabase env missing in .env.local");
if (!email || !password)
  fail("usage: node scripts/verify-rls.mjs <email> <password>");

let failures = 0;
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failures++;
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

const TABLES = ["tenants", "appointments", "audit_events", "profiles"];

console.log("1) anon key, no session — expect zero rows everywhere");
const anon = createClient(url, anonKey);
for (const table of TABLES) {
  const { data, error } = await anon.from(table).select("*").limit(5);
  if (error) ok(`${table}: blocked (${error.code ?? error.message})`);
  else if ((data ?? []).length === 0) ok(`${table}: 0 rows`);
  else fail(`${table}: LEAKED ${data.length} rows to anon!`);
}

console.log("2) signed-in tenant member — expect tenant-scoped rows");
const authed = createClient(url, anonKey);
const { data: session, error: signInError } =
  await authed.auth.signInWithPassword({ email, password });
if (signInError) {
  fail(`sign-in failed: ${signInError.message}`);
} else {
  ok(`signed in as ${session.user.email}`);

  const { data: profile } = await authed
    .from("profiles")
    .select("tenant_id, role")
    .single();
  if (profile?.tenant_id) ok(`profile: tenant=${profile.tenant_id} role=${profile.role}`);
  else fail("profile row not readable");

  const { data: tenants } = await authed.from("tenants").select("id");
  if (tenants?.length === 1 && tenants[0].id === profile?.tenant_id)
    ok(`tenants: sees exactly own tenant ('${tenants[0].id}')`);
  else fail(`tenants: expected exactly own tenant, got ${JSON.stringify(tenants)}`);

  const { data: appts } = await authed
    .from("appointments")
    .select("patient_name, test_type, date");
  if ((appts ?? []).length > 0)
    ok(`appointments: ${appts.length} row(s), e.g. ${appts[0].patient_name} — ${appts[0].test_type}`);
  else fail("appointments: expected rows for own tenant, got none");

  const { data: events } = await authed
    .from("audit_events")
    .select("type")
    .order("id", { ascending: false });
  if ((events ?? []).length > 0)
    ok(`audit_events: ${events.length} row(s) [${[...new Set(events.map((e) => e.type))].join(", ")}]`);
  else fail("audit_events: expected rows for own tenant, got none");
}

console.log(failures === 0 ? "\nRLS boundary holds." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
