# Jobproof

AI voice + SMS receptionist for US home-service trades (HVAC, plumbing,
electrical, pest control) — with proof-of-completion, not just booking.
Forked from the Receptionly/MedLab engine (Optipropose Studio's own IP,
not a client codebase).

**The difference from every other "AI receptionist" pitch:** booking a job
isn't the deliverable. A truck rolling, a technician showing up, and the job
actually getting finished is. Jobproof adds a verified physical close-out —
geofenced tech check-in/check-out plus a photo or e-signature on
completion — synced back to the customer's text thread and the owner's
dashboard.

## Structure

Same shape as Receptionly, minus the medical vertical:

| | What | Stack | Deploy |
|---|---|---|---|
| `engine/` | The receptionist — Twilio voice/SMS webhooks, Gemini function-calling conversation engine | Node/Express | Railway (new project — do not reuse Receptionly's) |
| `web/` | Tenant console — live job feed, scheduling, billing, proof-of-completion records | Next.js, Supabase, Stripe | Vercel (new project — do not reuse Receptionly's) |

Mission Control (agency-facing multi-tenant ops dashboard) is **not** forked
yet — add it once there are real paying trade-business tenants to manage
across, same sequencing as the medical vertical.

## Current state — this is a scaffold, not a working product yet

Copied from Receptionly's `console/dashboard-buildout` working tree
(commit `787d2c7` + uncommitted console changes) on 2026-07-16. Boots and
runs as-is (it's still the medical receptionist under the hood) but needs
the adaptation pass below before it's actually Jobproof.

See `CLAUDE.md` for the full list of what's generic (keep) vs. medical-only
(strip or replace) and the recommended order of work.

## Quick start

```bash
# engine
cd engine
npm install
cp .env.example .env      # fill in GEMINI_API_KEY + Twilio creds — get fresh ones, don't reuse Receptionly's
npm run dev                # :3000

# web (separate terminal)
cd web
npm install
cp .env.example .env.local
npm run dev                # :3001
```

Needs its own Supabase project, Stripe account/products, Twilio number, and
Railway/Vercel projects — none of Receptionly's production credentials or
infra should be shared with this product (different tenants, different
compliance posture, different billing).
