# Jobproof — CLAUDE.md

AI voice + SMS receptionist for US home-service trades, with verified
proof-of-completion. Forked from Receptionly (`AI-Receptionist/medlab-engine`
+ `medlab-web`) on 2026-07-16 — same underlying engine, different vertical.
Own IP (Optipropose Studio built the original engine); not derived from any
client codebase.

**Status as of 2026-08-01: renamed and demo-safe, not yet a finished
product.** The fork no longer boots or talks like Receptionly — branding,
the live voice/text scripts, and the compliance posture have all been
adapted (see "Done so far" below). What's left is the real product bet:
proof-of-completion doesn't exist yet, and the service catalog is still a
placeholder pending real input on what launches first.

---

## Done so far (2026-08-01)

- **Rebrand** — package names, env vars (`LAB_*` → `BUSINESS_*`), branding
  strings, and the example tenant (now "Ironclad Home Services") are
  scrubbed of MedLab/BrightPath/Receptionly references throughout
  `engine/` and `web/`. `engine/README.md`'s prose body still describes
  the pre-adapted state in places — not rewritten wholesale, just the
  parts that would actively mislead (env var names in the deploy table).
- **Live AI scripts genericized** — the voice greeting, the emergency
  redirect, the Gemini system prompt, and every tool description in
  `services/tools/schemas.js` no longer say "lab appointment" or "test
  type." This mattered more than dashboard copy: it's what a caller
  actually hears or reads on a real call/text.
- **Emergency detection expanded** — `compliance/emergency.js` now covers
  trades hazards (gas leak, electrical fire, flooding, carbon monoxide,
  downed power line) alongside the original medical-distress phrases,
  same fail-safe/over-trigger design.
- **Service catalog swapped** — `TEST_CATALOG` in `schemas.js` now holds
  generic placeholders (Service Call/Diagnostic, Repair, Installation,
  Maintenance, Inspection, Emergency Service) instead of medical lab
  tests. **Still a placeholder** — needs the real launch service list
  (see "What's left"). The `test_type`/`patient_name` field names were
  deliberately left as internal identifiers, not renamed, to avoid a
  schema churn nobody's confirmed the shape of yet.
- **PII posture partially replaced** — `compliance/redact.js` and
  `hipaa.js` no longer detect health-history terms; they reject
  payment-card numbers, CVVs, and SSNs instead (what a trades caller
  might actually blurt out that matters). The files are still named
  `hipaa.js`/`compliance/` and the Vertex AI/BAA path is still wired up
  untouched — see "What's left."
- **Owner SMS notification** (new capability, not in the original scope)
  — `notifyOwner()` in `services/twilio.js` texts `tenants.notify_phone`
  the moment a booking confirms, since a one-truck outfit isn't watching
  a dashboard between calls. Configurable from the Settings page.
  Fire-and-forget; no-ops silently if unset.
- **Compliance dashboard reskinned** — `/compliance` (dropped from the
  nav, still live at the URL) and the overview page's stat card no
  longer say PHI/HIPAA/BAA; the BAA-status section was replaced with an
  honest "data handling" summary since Jobproof has no BAA-equivalent
  concept.

## What's already generic — keep as-is

Per Receptionly's own architecture notes, most of the engine was never
medical-specific:

- Multi-tenant model (`tenants.id` slug, `TENANT_ID`/business env vars as
  single-tenant dev fallback, Twilio number → tenant routing)
- Twilio voice (`<Gather input="speech">` loop) + SMS/WhatsApp text channel,
  dedupe + batching (`routes/textChannel.js`)
- Gemini function-calling conversation loop (`services/gemini.js`)
- Session state (in-memory, TTL-swept, deterministic context compression)
- Dashboard event bus + SSE feed (`services/events.js`, `routes/dashboard.js`)
- Self-serve billing/onboarding state machine (`payment_pending →
  provisioning_pending_number → provisioning_active → live_active`), Stripe
  PaymentElement + $0 SetupIntent pattern, `activate-tenant.mjs` as the one
  place a real subscription gets created
- US-market guardrails — **all four keep, none are medical-specific**:
  - Emergency 911 gate (`compliance/emergency.js`) — a home-service caller
    in distress needs the same redirect a lab patient does
  - TCPA/CTIA STOP opt-out (`optouts` table, `routes/textChannel.js`)
  - AI disclosure (voice greeting + first text reply)
  - Caller-scoped cancel/reschedule (`find_my_appointments` /
    `cancel_appointment`, matched by caller ID)
- Twilio send-reliability (429 retry, `Retry-After` handling, redaction
  that doesn't mangle Twilio SIDs)

## What's left

- **`GEMINI_USE_VERTEX`/BAA path is completely untouched** — exists
  solely for HIPAA BAA coverage Jobproof doesn't need. Simplify to the AI
  Studio key path only, drop the Vertex branch entirely rather than
  carrying dead config.
- **`hipaa.js`/`phiRequestGuard`/`safeLog` naming** — the PII-detection
  *logic* was already retargeted to trades-relevant content (card
  numbers, CVVs, SSNs), but the module and a few function/comment names
  still say PHI/HIPAA. Zero exposure risk (nothing user-facing), low
  priority — fold into a rename pass if one ever happens.
- **Home address isn't collected anywhere.** `ALLOWED_APPOINTMENT_FIELDS`
  has no address field — fine for a lab (in-person visit to a fixed
  location), a real gap for a business dispatching a truck to the
  customer. Decide this alongside the real service catalog below, not in
  isolation — it's a schema decision (`sanitizeAppointment` whitelist,
  `book_appointment` tool schema, a new column), not a find-and-replace.
- **Tool vocabulary rename is still half-done.** `test_type`/
  `patient_name` field names, the `TEST_CATALOG` variable name, the
  `list_available_tests` tool name — all internal identifiers, never
  user-facing, deliberately left alone pending the real service-catalog +
  data-model decision (address included). Do this once, with the real
  answer, not piecemeal.
- **`EMAIL_FROM`** is currently a placeholder (`notifications@jobproof.ai`)
  — needs a real Jobproof sending domain verified in Resend before this
  goes anywhere near prod.
- **Owner notification is v1** — one phone number per tenant, no retry or
  escalation if it goes unread, not collected at signup (Settings only).
  Fine for now; revisit once there's a real multi-tech data model.

## The one piece that doesn't exist yet anywhere: proof-of-completion

This is Jobproof's actual differentiator and it's new work, not a rename:

- **Data model**: jobs need a `technician_id` (Receptionly is
  single-provider-per-location; most trades businesses run multiple
  trucks/techs per location — this is a real schema decision, not a
  find-and-replace), `checked_in_at`/`checked_out_at` timestamps, and a
  `proof_photo_url` and/or `signature_url`.
- **New Gemini tools or a separate tech-facing surface?** — worth deciding
  early whether check-in/check-out is a conversational tool call (tech
  texts "on site" / "done, signed") or a lightweight authenticated web
  view the tech opens on their phone (geofence + photo upload needs real
  browser APIs, a text-only flow can't do geofencing). Recommend the
  latter — a thin mobile-web page, not a new conversational surface.
  Recommend against building this until the base fork (rename + strip)
  is live and boring on at least one real trade business's calls.
- **Console surface**: `web/` needs a job close-out view (photo/signature,
  check-in/out timestamps) alongside the existing call-log/scheduling
  pages — new page, not a rename of an existing one.

## Recommended order of work

1. ~~Get the scaffold running under its own name locally~~ — **done.**
2. ~~Mechanical renames~~ — **done** (branding, env vars, example tenant;
   see "Done so far"). `engine/README.md`'s prose body is still stale in
   places, not actively misleading.
3. **Tool vocabulary + service catalog — partially done.** A safe generic
   placeholder catalog ships and the live scripts no longer say "lab" or
   "test." Still needed: the real launch service list, the `test_type`/
   `patient_name` field rename, and the home-address schema decision —
   all blocked on real business input, not effort.
4. **Strip HIPAA/Vertex — partially done.** PII detection is already
   retargeted to trades-relevant content (ahead of schedule). The
   Vertex/BAA path and `hipaa.js` module naming are untouched.
5. Proof-of-completion — new schema, new tech-facing check-in/out surface,
   new console page. This is the actual product bet; don't rush past
   steps 1-4 to get here, but don't gold-plate 1-4 either.
6. Mission Control fork — only once there are real paying tenants to view
   in a portfolio dashboard. Not before.

## Infra — do not share with Receptionly

New Railway project, new Vercel project, new Supabase project, new Stripe
account (or at minimum new products/prices), new Twilio number, new Resend
sending domain. Different tenants, different customers, different
compliance posture (no PHI here) — no reason to share infra, and sharing
would make Receptionly's HIPAA posture harder to reason about (BAA
coverage is Vertex-project-scoped).
