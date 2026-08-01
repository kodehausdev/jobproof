// Twilio transport: outbound WhatsApp sends (ported from TCD's
// whatsapp-twilio.js) and TwiML builders for the voice turn loop.

const axios = require('axios');
const config = require('../config');
const { safeLog } = require('../compliance/hipaa');

const MAX_429_RETRIES = 2;
// Generic-throttle backoff floor, used only when Twilio's 429 gives no
// Retry-After header. NOT a claim about why the 429 happened — Twilio's own
// error `code`/`message` says that; this is just a reasonable wait before
// trying again for a throttle-shaped error.
const DEFAULT_BACKOFF_MS = 3000;

// Twilio error codes that mean "retrying will fail again, don't bother":
// hard daily/monthly quotas, not a transient throttle.
// https://www.twilio.com/docs/api/errors/63038
const NON_RETRYABLE_429_CODES = new Set([63038]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs one Twilio message with bounded 429 retry. Twilio's own error
 * `message` is always the source of truth for *why* — logged verbatim,
 * never paraphrased or guessed at. Retry-After drives backoff timing when
 * present; a quota code like 63038 (daily limit) skips retries entirely
 * since Twilio won't accept the message again until the quota resets,
 * seconds later or not.
 */
async function postTwilioMessage(label, to, payload) {
  const { accountSid, authToken } = config.twilio;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        new URLSearchParams(payload).toString(),
        {
          auth: { username: accountSid, password: authToken },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      safeLog(`📤 [Twilio→${label}] sent to ${to}`);
      return true;
    } catch (e) {
      const status = e.response?.status;
      const code = e.response?.data?.code;
      const retryAfterHeader = e.response?.headers?.['retry-after'];
      const detail = e.response?.data?.message || e.message;
      const retryable = status === 429 && !NON_RETRYABLE_429_CODES.has(code);

      if (retryable && attempt < MAX_429_RETRIES) {
        const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : DEFAULT_BACKOFF_MS;
        safeLog(
          `⏳ Twilio ${label} send rate-limited (429) — retrying in ${(waitMs / 1000).toFixed(1)}s ` +
          `[attempt ${attempt + 1}/${MAX_429_RETRIES}]`
        );
        await sleep(waitMs);
        continue;
      }

      // Retry-After presence/absence is a fact worth logging; the REASON
      // for the 429 is whatever Twilio's own `detail` says above — never
      // paraphrased or guessed here.
      const retryHint = status === 429
        ? retryAfterHeader ? ` (retry after ${retryAfterHeader}s)` : ' (no Retry-After given)'
        : '';
      safeLog(`❌ Twilio ${label} send failed: ${status || ''} ${code || ''} ${detail}${retryHint}`);
      return false;
    }
  }
  return false;
}

async function sendWhatsApp(to, body) {
  const { whatsappNumber } = config.twilio;
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  await postTwilioMessage('WA', to, { From: whatsappNumber, To: toFormatted, Body: body });
}

/**
 * Outbound SMS. `from` is the tenant number the inbound text arrived on —
 * replies always come from the number the patient texted. Falls back to
 * TWILIO_SMS_NUMBER for sends outside a webhook context.
 */
async function sendSms(to, body, from) {
  const { smsNumber } = config.twilio;
  const fromNumber = from || smsNumber;
  if (!fromNumber) {
    safeLog('❌ Twilio SMS send skipped: no From number (set TWILIO_SMS_NUMBER)');
    return;
  }
  await postTwilioMessage('SMS', to, { From: fromNumber, To: to, Body: body });
}

/**
 * Texts the owner/dispatcher the moment a booking confirms — nobody running
 * a one-truck outfit is watching a dashboard between calls. No-ops silently
 * when the tenant hasn't set notify_phone (see services/tools/handlers.js,
 * the only caller). `from` is the tenant's own Twilio number when known;
 * sendSms falls back to TWILIO_SMS_NUMBER otherwise.
 */
async function notifyOwner(tenant, message) {
  if (!tenant?.notifyPhone) return;
  await sendSms(tenant.notifyPhone, message, tenant.twilioNumber || undefined);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * TwiML: speak `text`, then listen for the caller's next utterance and POST
 * the SpeechResult to `actionUrl`.
 */
function gatherTwiml(text, actionUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Google.en-US-Neural2-C">${escapeXml(text)}</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-C">I didn't hear anything. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

/** TwiML: speak a final message and hang up. */
function sayHangupTwiml(text) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-C">${escapeXml(text)}</Say>
  <Hangup/>
</Response>`;
}

/** TwiML: bridge the call into the Gemini Live media-stream endpoint (beta). */
function streamTwiml(wsUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}"/>
  </Connect>
</Response>`;
}

module.exports = { sendWhatsApp, sendSms, notifyOwner, gatherTwiml, sayHangupTwiml, streamTwiml };
