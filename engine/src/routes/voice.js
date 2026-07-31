// Voice channel — production path: Twilio <Gather input="speech"> turn loop.
//   POST /webhook/voice        → greeting + first Gather
//   POST /webhook/voice/turn   → SpeechResult → engine → Say + Gather (or Hangup)
// The streaming Gemini Live path is separate (see services/geminiLive.js)
// and is enabled per-tenant by pointing the Twilio number at /webhook/voice/stream.

const express = require('express');
const { gatherTwiml, sayHangupTwiml, streamTwiml } = require('../services/twilio');
const { safeLog } = require('../compliance/hipaa');
const config = require('../config');

function createVoiceRouter({ engine }) {
  const router = express.Router();
  const turnUrl = `${config.publicBaseUrl}/webhook/voice/turn`;

  router.post('/webhook/voice', async (req, res) => {
    // The called number identifies the tenant (multi-tenant routing).
    const tenant = await engine.resolveTenant(req.body?.To);
    // Proactive AI disclosure in the greeting (CA B.O.T. law / Utah AI
    // Policy Act posture): the caller hears they've reached an AI before
    // any data is collected.
    const greeting =
      `Thanks for calling ${tenant.labName}. ` +
      `I'm an automated A I assistant, and I can help book a service appointment — ` +
      `what do you need done, and when?`;
    res.type('text/xml').send(gatherTwiml(greeting, turnUrl));
  });

  router.post('/webhook/voice/turn', async (req, res) => {
    const from = req.body?.From || 'unknown';
    const to = req.body?.To;
    const speech = (req.body?.SpeechResult || '').trim();

    if (!speech) {
      return res.type('text/xml').send(
        gatherTwiml('Sorry, I did not catch that. Could you repeat it?', turnUrl)
      );
    }

    try {
      const { reply, bookedNow, emergency, session, tenant } =
        await engine.processTurn({ channel: 'voice', from, to, text: speech });

      // Emergency gate fired: deliver the scripted 911 redirect and release
      // the line immediately — no further Gather loop.
      if (emergency) {
        engine.endSession('voice', from, tenant.id);
        return res.type('text/xml').send(sayHangupTwiml(reply));
      }

      // After a confirmed booking, deliver the confirmation and end the call
      // on the model's closing turn rather than looping forever.
      if (bookedNow || (session.completed && /goodbye|bye|that's all|no thanks/i.test(speech))) {
        if (session.completed && !bookedNow) {
          engine.endSession('voice', from, tenant.id);
          return res.type('text/xml').send(sayHangupTwiml(reply));
        }
      }

      res.type('text/xml').send(gatherTwiml(reply, turnUrl));
    } catch (err) {
      safeLog(`❌ Voice turn failed: ${err.message}`);
      res.type('text/xml').send(
        sayHangupTwiml('Sorry, we are having technical trouble. Please call back shortly.')
      );
    }
  });

  // Beta: route a call into the Gemini Live bidirectional audio bridge.
  router.post('/webhook/voice/stream', (req, res) => {
    const wsUrl = config.publicBaseUrl.replace(/^http/, 'ws') + '/voice/stream';
    res.type('text/xml').send(streamTwiml(wsUrl));
  });

  return router;
}

module.exports = { createVoiceRouter };
