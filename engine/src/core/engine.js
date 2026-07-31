// Channel-agnostic conversation core. This is the descendant of TCD's
// handleMessage(): both the WhatsApp webhook and the voice turn loop feed
// into processTurn(), which owns tenant resolution, sessions, the Gemini
// engine, and tools.
//
// Multi-tenant routing: the inbound Twilio `To` number identifies the lab
// (tenants.twilio_number / whatsapp_number). Unmatched or absent numbers
// fall back to the env-configured default tenant, which also keeps the
// single-tenant dev/test setup working unchanged.

const { createSessionStore } = require('../services/session');
const { createGeminiEngine } = require('../services/gemini');
const { createToolHandlers } = require('../services/tools/handlers');
const { createEventBus } = require('../services/events');
const { createStore } = require('../db/client');
const { safeLog } = require('../compliance/hipaa');
const { containsEmergency, emergencyScript } = require('../compliance/emergency');
const config = require('../config');

const TENANT_CACHE_TTL_MS = 60 * 1000;

/**
 * createEngine(overrides) — every dependency is injectable for tests:
 *   { store, tenant, generateFn, now, events }
 */
function createEngine(overrides = {}) {
  const defaultTenant = overrides.tenant || config.tenant;
  const store = overrides.store || createStore();
  const events = overrides.events || createEventBus({ tenant: defaultTenant });
  const sessions = createSessionStore();
  const toolExecutor = createToolHandlers({ store, tenant: defaultTenant, events });
  const gemini = createGeminiEngine({
    tenant: defaultTenant,
    toolExecutor,
    generateFn: overrides.generateFn,
  });

  // Rehydrate the feed from the durable audit trail so a restart/redeploy
  // doesn't blank the console. seed() bypasses subscribers, so nothing here
  // re-persists or re-streams. index.js awaits `ready` before listening —
  // no live event can interleave with the replay. Injected buses (tests)
  // manage their own state.
  const ready =
    overrides.events || typeof store.auditSeed !== 'function'
      ? Promise.resolve()
      : store
          .auditSeed()
          .then((s) => { if (s) events.seed(s); })
          .catch((err) => safeLog(`⚠️ audit seed failed: ${err.message}`));

  // Every dashboard event is also persisted as a durable audit row
  // (PHI-minimized at the source — see services/events.js). Fire-and-forget:
  // an audit-write failure must never break a caller's turn.
  events.subscribe((ev) => {
    store
      .insertAuditEvent({
        tenant_id: ev.tenant_id,
        event_id: ev.id,
        type: ev.type,
        channel: ev.channel,
        phone_tail: ev.phone_tail,
        data: ev.data,
        created_at: ev.ts,
      })
      .catch((err) => safeLog(`⚠️ audit persist failed: ${err.message}`));
  });

  // Periodic PHI sweep of idle in-memory sessions.
  const sweeper = setInterval(() => sessions.sweep(), 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  // ── tenant resolution (inbound number → tenant, cached) ──────
  const tenantCache = new Map(); // normalized number → { tenant, at }

  async function resolveTenant(toNumber) {
    if (!toNumber) return defaultTenant;
    const number = String(toNumber).replace(/^whatsapp:/, '').trim();
    if (!number) return defaultTenant;

    const cached = tenantCache.get(number);
    if (cached && Date.now() - cached.at < TENANT_CACHE_TTL_MS) return cached.tenant;

    let tenant = null;
    try {
      tenant = await store.getTenantByNumber(number);
    } catch (err) {
      safeLog(`⚠️ tenant lookup failed for ${number}: ${err.message}`);
    }
    tenant = tenant || defaultTenant;
    tenantCache.set(number, { tenant, at: Date.now() });
    return tenant;
  }

  async function getTenantById(id) {
    if (!id || id === defaultTenant.id) return defaultTenant;
    try {
      return await store.getTenantById(id);
    } catch (err) {
      safeLog(`⚠️ tenant lookup failed for id=${id}: ${err.message}`);
      return null;
    }
  }

  // Sessions are keyed per tenant so the same caller phone talking to two
  // labs never shares conversation state.
  const sessionScope = (tenantId, channel) => `${tenantId}:${channel}`;

  /**
   * processTurn({ channel, from, to, text }) → { reply, bookedNow, session, tenant }
   *   channel: 'whatsapp' | 'voice'
   *   from: caller identifier (phone)
   *   to: the Twilio number the caller reached — resolves the tenant
   */
  async function processTurn({ channel, from, to, text }) {
    const tenant = await resolveTenant(to);
    const session = sessions.get(sessionScope(tenant.id, channel), from);
    safeLog(`📩 [${channel}] turn from ${from} → tenant ${tenant.id}`);

    const ctx = {
      channel,
      tenant,
      callerPhone: from.replace(/^whatsapp:/, ''),
      now: overrides.now,
    };

    // First turn of a fresh session = a new answered call/conversation.
    const firstTurn = session.history.length === 0;
    if (firstTurn) {
      events.emit('call.answered', {
        channel,
        phone: ctx.callerPhone,
        tenantId: tenant.id,
      });
    }

    // Hard emergency gate — model-independent, checked before Gemini sees
    // the turn. Scripted 911 redirect; the caller's text never enters
    // session history and no tools run. Fail-safe by design: a receptionist
    // must never triage.
    const emergencyHit = containsEmergency(text);
    if (emergencyHit) {
      safeLog(`🚨 emergency term detected (${channel}) — redirected to 911`);
      events.emit('emergency.detected', {
        channel,
        phone: ctx.callerPhone,
        tenantId: tenant.id,
      }, {
        status: 'emergency_redirected',
        summary:
          'Caller language suggested a possible emergency. ' +
          'Scripted 911 redirect delivered; no booking action taken.',
      });
      return {
        reply: emergencyScript(channel),
        bookedNow: false,
        emergency: true,
        session,
        tenant,
      };
    }

    const { reply, bookedNow } = await gemini.runTurn(session, text, ctx);
    if (bookedNow) session.completed = true;

    // Proactive AI disclosure on the first text reply of a conversation —
    // deterministic, not left to the model, on every text channel (SMS,
    // WhatsApp). Voice discloses in its greeting instead.
    const disclosed = firstTurn && channel !== 'voice'
      ? `You're chatting with ${tenant.labName}'s automated AI assistant.\n\n${reply}`
      : reply;

    return { reply: disclosed, bookedNow, session, tenant };
  }

  function endSession(channel, from, tenantId) {
    sessions.end(sessionScope(tenantId || defaultTenant.id, channel), from);
  }

  return {
    processTurn,
    endSession,
    resolveTenant,
    getTenantById,
    ready,
    store,
    tenant: defaultTenant,
    toolExecutor,
    events,
    _sessions: sessions,
  };
}

module.exports = { createEngine };
