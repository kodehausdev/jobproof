# Jobproof — CLAUDE.md

AI voice + SMS receptionist for US home-service trades, with verified
proof-of-completion. Forked from Receptionly (`AI-Receptionist/medlab-engine`
+ `medlab-web`) on 2026-07-16 — same underlying engine, different vertical.
Own IP (Optipropose Studio built the original engine); not derived from any
client codebase.

**This fork is a scaffold, not a working product.** It boots and runs
exactly like Receptionly still does, because nothing vertical-specific has
been changed yet. The rest of this file is the adaptation checklist —
work through it before calling this "Jobproof" in anything but name.

---

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

## What's medical-specific — needs replacing

- **`engine/src/compliance/hipaa.js`** — `sanitizeAppointment()`'s
  whitelist and `safeLog()`'s PHI redaction (SSNs, DOBs, insurance IDs,
  MRNs) are built for patient data. Trades jobs have their own sensitive
  fields (customer address, payment info) but not PHI — this should become
  a lighter general PII-redaction module, not a HIPAA-shaped one. Don't
  just delete it; decide what the trades equivalent of "never log this"
  is (likely: card details if ever seen, home address handled carefully)
  before touching `guardToolArgs()`.
- **Vertex AI / BAA path** (`GEMINI_USE_VERTEX`, ADC auth) — this exists
  solely for HIPAA BAA coverage. Nothing in Jobproof needs a BAA. Simplify
  to the AI Studio key path only, drop the Vertex branch entirely rather
  than carrying dead config.
- **Tool vocabulary** (`engine/src/services/tools/schemas.js`) —
  `TEST_CATALOG` → a service catalog (HVAC repair, plumbing repair,
  electrical inspection, pest control treatment, etc. — needs real input
  on what services Jobproof actually offers at launch). `test_type` →
  `service_type`, `book_appointment` → `book_job`, appointments → jobs
  throughout. `TOOL_ARG_WHITELIST` moves with it.
- **Env vars** (`.env.example` in both `engine/` and `web/`) —
  `LAB_NAME`/`LAB_TIMEZONE`/`LAB_OPEN_HOUR`/`LAB_CLOSE_HOUR`/
  `SLOT_CAPACITY` → business-name/hours equivalents. `EMAIL_FROM` still
  says `MedLab AI <notifications@medlab.ai>` — needs a real Jobproof
  sending domain verified in Resend before this goes anywhere near prod.
- **Branding references** — anything mentioning "MedLab," "Receptionly,"
  "BrightPath Diagnostics" (the example tenant name), or the Ava/Beacon
  persona-naming discussion is leftover from the medical vertical and
  should be scrubbed as it's found, not hunted down exhaustively up front.

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

1. Get the scaffold running under its own name locally (this session's
   job) — new Supabase project, new Twilio number, new Stripe test mode,
   confirm both `engine/` and `web/` boot.
2. Mechanical renames: package names, env var names, branding strings,
   example tenant name. No behavior change, just makes the codebase
   honestly say what it is.
3. Tool vocabulary + service catalog — needs a real answer on what
   services launch first, from whoever's selling this.
4. Strip HIPAA/Vertex, replace with a lighter PII posture appropriate to
   trades data.
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
