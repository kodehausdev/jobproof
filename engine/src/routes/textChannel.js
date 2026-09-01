// Shared text-channel webhook (SMS + WhatsApp). Direct port of TCD's
// /webhook/twilio pattern: ack immediately, dedupe on MessageSid, batch
// rapid messages per sender — with a short window (4s) tuned for
// conversation, not bulk paste.
//
// TCPA/CTIA opt-out handling sits BETWEEN dedupe and the engine: STOP-family
// keywords are honored deterministically — an opt-out must never depend on
// LLM interpretation. Opted-out numbers get no AI processing and no outbound
// sends except the scripted opt-out/opt-in service notes. This matters even
// more on SMS than WhatsApp — SMS is the primary US text-to-book channel.

const express = require('express');
const { safeLog } = require('../compliance/hipaa');

const BATCH_WINDOW_MS = 4000;
const DEDUPE_MAX = 1000;
const MAX_TURN_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 3000;

// Transient failures (rate limit, model overloaded, network blip) are worth
// a couple of retries before giving up — Gemini itself tells us how long to
// wait via the RESOURCE_EXHAUSTED retryDelay. A genuine bug or a
// ComplianceError will fail the same way every time, so those go straight
// to the fallback message instead of wasting retries.
function isRetryable(err) {
  const msg = String(err?.message || '');
  return /"code":\s*429|RESOURCE_EXHAUSTED|"code":\s*503|UNAVAILABLE|ECONNRESET|ETIMEDOUT/i.test(msg);
}

// Gemini's 429 body includes retryDelay":"6s" — honor it when present
// instead of guessing.
function retryDelayMs(err) {
  const match = String(err?.message || '').match(/retryDelay"\s*:\s*"(\d+)s"/);
  return match ? Number(match[1]) * 1000 : DEFAULT_RETRY_DELAY_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CTIA-standard keyword sets, exact whole-message match (case-insensitive,
// trailing punctuation ignored). Note "cancel" alone opts out per CTIA —
// "cancel my appointment" does NOT match and flows to the engine normally.
const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'end', 'quit', 'cancel']);
const OPT_IN_KEYWORDS = new Set(['start', 'unstop', 'yes']);

function normalizeKeyword(text) {
  return String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '');
}

/**
 * createTextChannelRouter({ engine, send, channel, webhookPath, batchWindowMs })
 *   channel     — 'sms' | 'whatsapp' (session scoping, events, appointment rows)
 *   webhookPath — where Twilio posts inbound messages
 *   send(recipient, body, viaNumber) — outbound reply; viaNumber is the tenant
 *     number the inbound message arrived on, so SMS replies come from the
 *     number the patient texted (WhatsApp ignores it and uses its own sender).
 */
function createTextChannelRouter({ engine, send, channel, webhookPath, batchWindowMs = BATCH_WINDOW_MS }) {
  const router = express.Router();
  const processed = new Set();
  const messageQueue = {};

  async function handleTurn(from, to, text) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_TURN_RETRIES; attempt++) {
      try {
        const { reply } = await engine.processTurn({ channel, from, to, text });
        await send(from, reply, to);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_TURN_RETRIES && isRetryable(err)) {
          const delay = retryDelayMs(err);
          safeLog(`⏳ ${channel} turn failed (attempt ${attempt + 1}/${MAX_TURN_RETRIES + 1}), retrying in ${delay}ms: ${err.message}`);
          await sleep(delay);
          continue;
        }
        break;
      }
    }
    safeLog(`❌ ${channel} turn failed: ${lastErr.message}`);
    await send(
      from,
      'Sorry — something went wrong on our side. Please send that again in a moment.',
      to
    );
  }

  // Deterministic opt-out/opt-in gate. Returns true when the message was
  // consumed here (keyword honored or sender suppressed) and must not reach
  // the engine.
  async function handleOptOut(from, to, text) {
    const phone = from.replace(/^whatsapp:/, '');
    const tenant = await engine.resolveTenant(to);
    const keyword = normalizeKeyword(text);

    if (OPT_OUT_KEYWORDS.has(keyword)) {
      await engine.store.setOptOut(tenant.id, phone, true);
      engine.endSession(channel, from, tenant.id);
      engine.events.emit('optout.received', {
        channel, phone, tenantId: tenant.id,
      }, {
        status: 'opted_out',
        summary: 'Caller sent a STOP keyword. Opt-out recorded; all outbound messages suppressed.',
      });
      safeLog(`🛑 [${channel}] opt-out recorded for ${from} [${tenant.id}]`);
      await send(
        from,
        `You've been unsubscribed from ${tenant.labName} messages and will receive no further texts. Reply START to opt back in.`,
        to
      );
      return true;
    }

    const optedOut = await engine.store.isOptedOut(tenant.id, phone);
    if (!optedOut) return false;

    if (OPT_IN_KEYWORDS.has(keyword)) {
      await engine.store.setOptOut(tenant.id, phone, false);
      engine.events.emit('optout.restored', {
        channel, phone, tenantId: tenant.id,
      }, {
        status: 'opted_in',
        summary: 'Caller sent a START keyword. Opt-out lifted; messaging resumed.',
      });
      safeLog(`▶️ [${channel}] opt-in restored for ${from} [${tenant.id}]`);
      await send(
        from,
        `You're re-subscribed to ${tenant.labName} messages. How can I help with your service appointment?`,
        to
      );
      return true;
    }

    // Opted out and not opting back in: no AI processing, one scripted
    // service note so the silence isn't a dead end.
    safeLog(`🔇 [${channel}] suppressed message from opted-out ${from} [${tenant.id}]`);
    await send(
      from,
      'You previously opted out of messages from this number. Reply START to opt back in.',
      to
    );
    return true;
  }

  router.post(webhookPath, (req, res) => {
    res.sendStatus(200); // ack before processing, Twilio retries otherwise

    const from = req.body?.From;
    const to = req.body?.To; // number the message arrived on → tenant
    const text = req.body?.Body?.trim();
    if (!from || !text) return;

    const msgSid = req.body?.MessageSid || `${from}:${Date.now()}`;
    if (processed.has(msgSid)) return;
    processed.add(msgSid);
    if (processed.size > DEDUPE_MAX) processed.clear();

    safeLog(`📩 [${channel}] inbound from ${from}`);

    handleOptOut(from, to, text)
      .then((consumed) => {
        if (consumed) return;

        // Batch rapid consecutive messages (people text in fragments) into one
        // turn — keyed per (tenant number, sender) so labs never share a batch.
        const qk = `${to || 'default'}|${from}`;
        if (!messageQueue[qk]) messageQueue[qk] = { texts: [], timer: null };
        messageQueue[qk].texts.push(text);
        if (messageQueue[qk].timer) clearTimeout(messageQueue[qk].timer);
        messageQueue[qk].timer = setTimeout(() => {
          const batch = messageQueue[qk].texts.join('\n');
          delete messageQueue[qk];
          handleTurn(from, to, batch);
        }, batchWindowMs);
      })
      .catch((err) => safeLog(`❌ ${channel} opt-out gate failed: ${err.message}`));
  });

  return router;
}

module.exports = { createTextChannelRouter, BATCH_WINDOW_MS, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS };
