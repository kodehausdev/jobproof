// MedLab AI Receptionist — entrypoint.
// createApp() is exported separately so the test suite can build the app
// with injected mocks and never open a port or touch the network.

const express = require('express');
const config = require('./config');
const { createEngine } = require('./core/engine');
const { createWhatsAppRouter } = require('./routes/whatsapp');
const { createSmsRouter } = require('./routes/sms');
const { createVoiceRouter } = require('./routes/voice');
const { createDashboardRouter } = require('./routes/dashboard');
const { twilioSignatureGuard } = require('./services/twilioSig');
const { sendWhatsApp, sendSms } = require('./services/twilio');
const { phiRequestGuard, safeLog } = require('./compliance/hipaa');

function createApp(overrides = {}) {
  const engine = overrides.engine || createEngine(overrides);
  const send = overrides.sendWhatsApp || sendWhatsApp;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // Twilio posts form data
  app.use(phiRequestGuard);
  app.use('/webhook', twilioSignatureGuard({
    authToken: config.twilio.authToken,
    publicBaseUrl: config.publicBaseUrl,
    enabled: config.twilio.validateWebhooks,
  }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, tenant: engine.tenant.id, store: engine.store.kind });
  });

  app.use(createWhatsAppRouter({
    engine,
    sendWhatsApp: send,
    batchWindowMs: overrides.batchWindowMs,
  }));
  app.use(createSmsRouter({
    engine,
    sendSms: overrides.sendSms || sendSms,
    batchWindowMs: overrides.batchWindowMs,
  }));
  app.use(createVoiceRouter({ engine }));
  app.use(createDashboardRouter({ engine, auth: overrides.dashboardAuth }));

  return { app, engine };
}

if (require.main === module) {
  const { app, engine } = createApp();
  // Feed rehydration finishes before we take traffic, so live events can't
  // interleave with the audit-trail replay.
  engine.ready.then(() => {
    const server = app.listen(config.port, () => {
      const auth = config.gemini.useVertex
        ? `vertex-adc (${config.gemini.project || 'NO PROJECT SET'} / ${config.gemini.location})`
        : (config.gemini.apiKey ? 'api-key' : 'none — set GEMINI_API_KEY or GEMINI_USE_VERTEX');
      safeLog(`🚀 MedLab Receptionist [${engine.tenant.labName}] on :${config.port}`);
      safeLog(`   store=${engine.store.kind} model=${config.gemini.model} auth=${auth}`);
    });

    // Beta streaming voice path — only meaningful with a live Gemini key.
    if (config.gemini.apiKey) {
      const { attachLiveBridge } = require('./services/geminiLive');
      attachLiveBridge(server, { engine });
      safeLog('🎙️ Gemini Live bridge attached at /voice/stream (beta)');
    }
  });
}

module.exports = { createApp };
