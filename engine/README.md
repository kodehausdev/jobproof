> Forked from Receptionly's `medlab-engine` on 2026-07-16, not yet adapted
> — everything below still describes the medical vertical this was copied
> from. See `../CLAUDE.md` for what needs to change and in what order
> before this is actually Jobproof.

# MedLab AI Receptionist — Engine

HIPAA-conscious voice + WhatsApp appointment receptionist for medical labs.
B2B SaaS, $297/mo per location. Repurposed from the TCD logistics ops engine
(`Abuja-Ops-Project/tollyclassic-ops-TCD-`): same webhook ingestion, dedupe,
and per-sender batching skeleton — the one-shot Gemini order parser is
replaced by a stateful, tool-calling conversation engine.

## Directory architecture

```
medlab-engine/
├── package.json
├── .env.example
├── src/
│   ├── index.js                  # createApp() + server bootstrap
│   ├── config.js                 # env → typed config (gemini/twilio/tenant)
│   ├── core/
│   │   └── engine.js             # channel-agnostic processTurn() — descendant
│   │                             #   of TCD handleMessage(); all deps injectable
│   ├── routes/
│   │   ├── textChannel.js        # shared SMS/WA webhook — ack-first, MessageSid
│   │   │                         #   dedupe, TCPA opt-out gate, 4s batching
│   │   ├── sms.js                # POST /webhook/sms — US text-to-book (primary)
│   │   ├── whatsapp.js           # POST /webhook/whatsapp
│   │   ├── voice.js              # POST /webhook/voice (+/turn, +/stream) —
│   │   │                         #   <Gather input="speech"> turn loop (prod path)
│   │   └── dashboard.js          # GET /api/dashboard/state + /events (SSE) —
│   │                             #   read-only feed for the front-desk console
│   ├── services/
│   │   ├── events.js             # dashboard event bus — PHI-minimized envelope,
│   │   │                         #   ring buffer + counters, SSE subscribers
│   │   ├── gemini.js             # system prompt, function-calling loop (max 4
│   │   │                         #   rounds), generateFn seam for mocks/model swap
│   │   ├── geminiLive.js         # BETA: Twilio Media Streams ↔ Gemini Live WS
│   │   │                         #   bridge, μ-law 8k ↔ PCM 16k/24k transcode
│   │   ├── session.js            # in-memory sessions, TTL sweep, deterministic
│   │   │                         #   context compression (facts, not transcript)
│   │   ├── twilio.js             # outbound WA send + TwiML builders
│   │   └── tools/
│   │       ├── schemas.js        # functionDeclarations + arg whitelists + catalog
│   │       └── handlers.js       # check_availability / book_appointment /
│   │                             #   list_available_tests (guarded dispatch)
│   ├── compliance/
│   │   ├── hipaa.js              # sanitizeAppointment, guardToolArgs, safeLog
│   │   └── redact.js             # PHI regexes, health-history detector
│   └── db/
│       ├── client.js             # Supabase store / in-memory fallback
│       └── schema.sql            # tenants, appointments, audit_events
└── test/
    └── simulation.test.js        # 15 offline E2E + guardrail tests (node --test)
```

## Logistics → MedLab mapping

| TCD (logistics) | MedLab (receptionist) |
|---|---|
| `/webhook/twilio` order paste | `/webhook/whatsapp` conversational turn |
| `processed` Set (MessageSid dedupe) | same, per router |
| 12s batch window (bulk forwards) | 4s window (fragmented texting) |
| `parseOrder()` one-shot JSON extract | `runTurn()` multi-round function calling |
| zone keyword overrides | test-catalog fuzzy matching |
| `saveOrder()` free-form insert | `sanitizeAppointment()` whitelist-only insert |
| dispatcher auto-assign | slot capacity enforcement |

## HIPAA posture (minimum necessary)

1. **Nothing unstructured is ever persisted.** Conversation state is
   in-memory only, TTL-swept after 15 idle minutes. The only durable patient
   data is the `appointments` row: name, phone, test type, date, slot,
   channel, status, timestamp.
2. **`sanitizeAppointment()`** is the only write path — non-whitelisted
   fields are dropped; health-history content in a whitelisted field throws.
3. **`guardToolArgs()`** intercepts every Gemini function call before
   execution: hallucinated fields stripped, diagnosis/history content
   rejected with a refusal the model must relay.
4. **`safeLog()`** redacts SSNs, DOBs, insurance/member IDs, emails,
   addresses, MRNs, and masks phone numbers on every log line.
5. The system prompt forbids collecting anything beyond the four fields and
   scripts the deflection when callers volunteer health details.

## US-market guardrails

Model-independent gates layered on top of the HIPAA controls:

1. **Emergency detection** (`compliance/emergency.js`) — distress language
   ("chest pain", "can't breathe", suicide/overdose terms, …) is checked on
   the raw caller text *before* the turn reaches Gemini. On match: scripted
   911/ER redirect, `emergency.detected` audit event, no tools run, the
   caller's words never enter session history; voice hangs up after the
   script. Deliberately over-triggers — a receptionist must never triage.
2. **TCPA/CTIA opt-out** (`routes/textChannel.js` + `optouts` table) — exact
   whole-message STOP-family keywords are honored deterministically on both
   SMS and WhatsApp, never routed through the model. Opted-out numbers get
   no AI processing and no outbound sends beyond a scripted "reply START to
   opt back in" note. START/UNSTOP/YES reverses it. Note: bare "cancel"
   opts out per CTIA; "cancel my appointment" flows to the engine normally.
3. **AI disclosure** (CA B.O.T. law / Utah AI Policy Act posture) — the
   voice greeting and the first text reply of every conversation (SMS and
   WhatsApp) disclose the AI deterministically; the system prompt
   additionally forbids ever claiming to be human.
4. **Caller-scoped cancel/reschedule** — `find_my_appointments` +
   `cancel_appointment` tools match strictly by caller ID; a booking_id
   that isn't among the caller's own upcoming appointments is refused, so
   ids can't be guessed to cancel someone else's booking. Reschedule =
   cancel + rebook. Emits `booking.cancelled`.

## Twilio send reliability

`services/twilio.js` retries outbound sends up to twice on HTTP 429,
honoring Twilio's `Retry-After` header when present. Known non-retryable
error codes (currently just `63038`, a trial-account daily quota) skip
retries entirely rather than burning time on a request that can't succeed
until the quota resets — **this is not an account flag or blacklist
signal**, it's the standard 50 message/day cap every Twilio trial account
has, on a rolling 24h window; upgrading off the trial tier removes it.
Failure logs always use Twilio's own `message`/`code` verbatim, never a
guessed explanation. Separately, `compliance/redact.js`'s phone-number
regex is boundary-checked so it doesn't mangle Twilio SIDs (long hex
strings that frequently contain 9+ consecutive digits) when redacting log
lines — a real bug that corrupted diagnostic detail before it was fixed.

> Note: technical controls ≠ compliance. Production still needs a Twilio
> BAA (available on their HIPAA-eligible products), hosting under a BAA,
> access controls, and a signed BAA with each lab customer. For the model
> API, set `GEMINI_USE_VERTEX=true` to route through Vertex AI
> (HIPAA-eligible, same models, same function-calling API) — the AI Studio
> key path is for development only.

## Running

```bash
npm install
cp .env.example .env      # fill GEMINI_API_KEY + Twilio creds
npm start                 # boots on :3000, in-memory store without Supabase
npm test                  # 15 offline tests, no keys required
```

Model auth is either/or:

- **Dev:** `GEMINI_API_KEY` from AI Studio (no BAA — sandbox only).
- **Production (Vertex AI, HIPAA-eligible):** `GEMINI_USE_VERTEX=true` +
  `GOOGLE_CLOUD_PROJECT` (+ optional `GOOGLE_CLOUD_LOCATION`, default
  `us-central1`). No key file: run `gcloud auth application-default login`
  locally, or attach the service account to the runtime when deployed.
  Requires the **Vertex AI User** role (`roles/aiplatform.user`) on the
  project — no service-account key creation needed, so the
  `iam.disableServiceAccountKeyCreation` org policy is irrelevant here.
  The beta Live voice bridge (`geminiLive.js`) still requires an API key.

Point the Twilio number at:
- Voice webhook → `POST {PUBLIC_BASE_URL}/webhook/voice` (Gather loop, prod)
- SMS/Messaging webhook → `POST {PUBLIC_BASE_URL}/webhook/sms` (primary US
  text-to-book channel — the same number carries voice and SMS)
- WhatsApp webhook → `POST {PUBLIC_BASE_URL}/webhook/whatsapp`
- Streaming voice (beta) → `POST {PUBLIC_BASE_URL}/webhook/voice/stream`

## Dashboard feed (front-desk console)

`../MedLab Dashboard.dc.html` connects to the engine over Server-Sent Events
and renders the live call feed. With the engine down it falls back to its
scripted demo data (header badge shows `DEMO DATA` vs `ENGINE LIVE`).

- `GET /api/dashboard/state` — snapshot: tenant, counters
  (`calls_answered`, `bookings_confirmed`, `guardrail_events`), and the
  last 50 events.
- `GET /api/dashboard/events` — SSE stream. Replays the ring buffer on
  connect, then streams live. Event envelope:

```json
{
  "id": "evt-7",
  "type": "call.answered | booking.confirmed | guardrail.redacted",
  "ts": "2026-07-04T15:42:00.000Z",
  "tenant_id": "default",
  "channel": "voice",
  "phone_tail": "4567",
  "data": { "…type-specific, PHI-minimized…" }
}
```

`booking.confirmed` carries `booking_id, client_name, test_type, date,
time_slot, status, summary`. `guardrail.redacted` (emitted whenever the
compliance layer throws a `ComplianceError`) carries only `tool, code,
status, summary` — never the caller's words or the matched health-history
term. The dashboard renders it instantly as a red **Guardrail Redacted** row.

> The feed is unauthenticated and CORS-open for local development (the
> console opens from `file://`). Events are minimum-necessary (name +
> phone tail only), but put this behind auth and a pinned origin before
> exposing it beyond localhost.

## Deploying (Railway)

The repo is a monorepo — point Railway's service **Root Directory** at
`medlab-engine/`. `railway.json` configures the `/health` healthcheck;
Railway injects `PORT`.

Environment variables to set on the service:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | AI Studio key — see ⚠ below |
| `GEMINI_USE_VERTEX` | `false` on Railway (see ⚠ below) |
| `SUPABASE_URL` / `SUPABASE_KEY` | project URL + service-role key |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | account creds |
| `TWILIO_WHATSAPP_NUMBER` | e.g. `whatsapp:+14155238886` (sandbox) |
| `TWILIO_VALIDATE_WEBHOOKS` | `true` — rejects requests without a valid `X-Twilio-Signature` |
| `PUBLIC_BASE_URL` | the Railway domain, e.g. `https://<svc>.up.railway.app` |
| `TENANT_ID` / `BUSINESS_NAME` / `BUSINESS_*` / `SLOT_CAPACITY` | default-tenant fallback |

Then point the Twilio number's webhooks at
`{PUBLIC_BASE_URL}/webhook/voice` and `{PUBLIC_BASE_URL}/webhook/whatsapp`.

> ⚠ **Vertex AI off-GCP:** ADC doesn't exist on Railway — Vertex auth there
> needs a service-account key (blocked by the org policy) or Workload
> Identity Federation. Until the production GCP org is set up, the Railway
> deployment uses an AI Studio `GEMINI_API_KEY` (no BAA — sandbox posture).
> The BAA-grade path is running the engine on Cloud Run with an attached
> service account, or WIF — both keyless.

### Dashboard API auth

With Supabase configured, `/api/dashboard/*` requires a Supabase user
access token (`Authorization: Bearer …` or `?token=` for SSE). The engine
verifies it against Supabase Auth, maps it to the caller's tenant via
`profiles`, and pins the feed to that tenant — a `?tenant=` for anyone
else's lab returns 403. Keyless local dev (memory store) stays open.

## Voice paths

- **Production (verified):** Twilio `<Gather input="speech">` turn loop.
  Twilio does STT, Gemini Flash handles the turn with tools, TwiML `<Say>`
  speaks the reply. Deterministic, testable, no audio infra.
- **Beta:** `services/geminiLive.js` bridges Twilio Media Streams to the
  Gemini Live `BidiGenerateContent` WebSocket (full-duplex audio, barge-in
  via `clear` frames, same guarded tool executor). Complete but requires
  live-key call testing before a tenant is pointed at it.
