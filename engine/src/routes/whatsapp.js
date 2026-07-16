// WhatsApp text channel — thin wrapper over the shared text-channel webhook
// (see textChannel.js for dedupe, TCPA opt-out gate, and batching).
// Outbound replies go through sendWhatsApp, which prefixes 'whatsapp:' and
// sends from the configured WA sender; the inbound tenant number is unused.

const { createTextChannelRouter, BATCH_WINDOW_MS, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } =
  require('./textChannel');

function createWhatsAppRouter({ engine, sendWhatsApp, batchWindowMs }) {
  return createTextChannelRouter({
    engine,
    channel: 'whatsapp',
    webhookPath: '/webhook/whatsapp',
    send: (recipient, body) => sendWhatsApp(recipient, body),
    batchWindowMs,
  });
}

module.exports = { createWhatsAppRouter, BATCH_WINDOW_MS, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS };
