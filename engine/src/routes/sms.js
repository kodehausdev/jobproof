// SMS text channel — the primary US text-to-book path. Thin wrapper over the
// shared text-channel webhook (see textChannel.js for dedupe, TCPA opt-out
// gate, and batching). Replies are sent from the tenant number the patient
// texted, so multi-tenant labs each answer from their own line.
//
// Point the Twilio number's Messaging webhook at
// POST {PUBLIC_BASE_URL}/webhook/sms — the same number can carry voice
// (/webhook/voice) and SMS simultaneously.

const { createTextChannelRouter } = require('./textChannel');

function createSmsRouter({ engine, sendSms, batchWindowMs }) {
  return createTextChannelRouter({
    engine,
    channel: 'sms',
    webhookPath: '/webhook/sms',
    send: (recipient, body, viaNumber) => sendSms(recipient, body, viaNumber),
    batchWindowMs,
  });
}

module.exports = { createSmsRouter };
