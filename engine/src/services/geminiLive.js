// BETA — Gemini Live ↔ Twilio Media Streams bridge.
//
// Twilio side:  WebSocket at /voice/stream, frames of base64 G.711 μ-law @ 8kHz.
// Gemini side:  BidiGenerateContent WebSocket, PCM16 @ 16kHz in, PCM16 @ 24kHz out.
// This module transcodes both directions and forwards Gemini toolCall events
// into the same guarded tool executor the text path uses.
//
// Ship-note (July 7 deadline): the <Gather> loop in routes/voice.js is the
// verified production path. This bridge is complete but requires live-key
// testing before a tenant is pointed at it.

const WebSocket = require('ws');
const config = require('../config');
const { functionDeclarations } = require('./tools/schemas');
const { buildSystemPrompt } = require('./gemini');
const { safeLog } = require('../compliance/hipaa');

// ── G.711 μ-law codec ─────────────────────────────────────────
const BIAS = 0x84, CLIP = 32635;

function muLawDecodeSample(u) {
  u = ~u & 0xff;
  const sign = u & 0x80, exp = (u >> 4) & 0x07, mant = u & 0x0f;
  let sample = ((mant << 3) + BIAS) << exp;
  sample -= BIAS;
  return sign ? -sample : sample;
}

function muLawEncodeSample(s) {
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

/** μ-law 8kHz buffer → PCM16LE 16kHz buffer (decode + 2x linear upsample). */
function muLaw8kToPcm16k(muBuf) {
  const out = Buffer.alloc(muBuf.length * 2 * 2);
  let prev = 0;
  for (let i = 0; i < muBuf.length; i++) {
    const cur = muLawDecodeSample(muBuf[i]);
    out.writeInt16LE(Math.round((prev + cur) / 2), i * 4);     // interpolated
    out.writeInt16LE(cur, i * 4 + 2);                           // original
    prev = cur;
  }
  return out;
}

/** PCM16LE 24kHz buffer → μ-law 8kHz buffer (3:1 decimate + encode). */
function pcm24kToMuLaw8k(pcmBuf) {
  const samples = Math.floor(pcmBuf.length / 2 / 3);
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = muLawEncodeSample(pcmBuf.readInt16LE(i * 6));
  }
  return out;
}

// ── Bridge ────────────────────────────────────────────────────
const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/' +
  'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * attachLiveBridge(httpServer, { engine })
 * Upgrades /voice/stream connections and runs one Gemini Live session per call.
 */
function attachLiveBridge(server, { engine }) {
  const wss = new WebSocket.Server({ server, path: '/voice/stream' });

  wss.on('connection', (twilioWs) => {
    safeLog('🎙️ Media stream connected');
    let streamSid = null;
    let callerPhone = 'unknown';
    let gemini = null;

    function openGemini() {
      const url = `${GEMINI_LIVE_URL}?key=${config.gemini.apiKey}`;
      gemini = new WebSocket(url);

      gemini.on('open', () => {
        const todayISO = new Date().toISOString().split('T')[0];
        gemini.send(JSON.stringify({
          setup: {
            model: `models/${config.gemini.liveModel}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
              },
            },
            systemInstruction: {
              parts: [{ text: buildSystemPrompt(engine.tenant, todayISO) }],
            },
            tools: [{ functionDeclarations }],
          },
        }));
      });

      gemini.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // Audio out → transcode → Twilio media frames
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          const b64 = part.inlineData?.data;
          if (!b64 || !streamSid) continue;
          const mu = pcm24kToMuLaw8k(Buffer.from(b64, 'base64'));
          twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: mu.toString('base64') },
          }));
        }

        // Caller barge-in: clear Twilio's audio buffer
        if (msg.serverContent?.interrupted && streamSid) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }

        // Tool calls → same guarded executor as the text path
        if (msg.toolCall?.functionCalls?.length) {
          const responses = [];
          for (const fc of msg.toolCall.functionCalls) {
            safeLog(`🔧 [live] tool call: ${fc.name}`);
            const result = await engine.toolExecutor.execute(
              fc.name, fc.args, { channel: 'voice', callerPhone }
            );
            responses.push({ id: fc.id, name: fc.name, response: { result } });
          }
          gemini.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        }
      });

      gemini.on('error', (e) => safeLog(`❌ Gemini Live error: ${e.message}`));
      gemini.on('close', () => safeLog('🔌 Gemini Live closed'));
    }

    twilioWs.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.event) {
        case 'start':
          streamSid = msg.start?.streamSid;
          callerPhone = msg.start?.customParameters?.from || 'unknown';
          openGemini();
          break;
        case 'media': {
          if (!gemini || gemini.readyState !== WebSocket.OPEN) break;
          const pcm = muLaw8kToPcm16k(Buffer.from(msg.media.payload, 'base64'));
          gemini.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: pcm.toString('base64') }],
            },
          }));
          break;
        }
        case 'stop':
          if (gemini) gemini.close();
          break;
      }
    });

    twilioWs.on('close', () => {
      if (gemini) gemini.close();
      safeLog('🎙️ Media stream disconnected');
    });
  });

  return wss;
}

module.exports = {
  attachLiveBridge,
  // exported for unit-testing the codec math
  muLaw8kToPcm16k, pcm24kToMuLaw8k, muLawEncodeSample, muLawDecodeSample,
};
