// Gemini service wrapper: system prompt, function-calling loop, and the
// adapter seam that lets tests inject a deterministic mock model.
//
// Uses @google/genai, which speaks both backends:
//   - AI Studio (GEMINI_API_KEY) — dev/sandbox, no BAA
//   - Vertex AI (GEMINI_USE_VERTEX=true + GOOGLE_CLOUD_PROJECT) — the
//     HIPAA-eligible production route, authenticated via ADC, no key file

const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { functionDeclarations } = require('./tools/schemas');
const { safeLog } = require('../compliance/hipaa');
const { compressHistory } = require('./session');

const MAX_TOOL_ROUNDS = 4;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function buildSystemPrompt(tenant, todayISO) {
  const base = new Date(`${todayISO}T00:00:00Z`);
  const weekday = WEEKDAYS[base.getUTCDay()];
  // Models are unreliable at weekday arithmetic — hand them the next 7 days
  // resolved, so "this Thursday" maps to a date by lookup, not calculation.
  const calendar = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    calendar.push(`${WEEKDAYS[d.getUTCDay()]} = ${d.toISOString().split('T')[0]}`);
  }
  return `You are the phone/text receptionist for ${tenant.labName}, a home-service business.
Today's date is ${todayISO}, a ${weekday}. The next seven days are: ${calendar.join(', ')}.
Business hours are ${String(tenant.openHour).padStart(2, '0')}:00 to ${String(tenant.closeHour).padStart(2, '0')}:00, appointments on 30-minute slots.

YOUR ONLY JOB: help callers book, check, cancel, or reschedule service appointments.

TRANSPARENCY (legal requirement):
- You are an AI assistant. If a caller asks whether they are talking to a human, a bot, or an AI — in any words — say plainly that you are an automated AI assistant. Never claim or imply you are human.
- You cannot give technical or safety advice, and you cannot handle emergencies. If a caller has an urgent safety issue (gas leak, electrical hazard, flooding, fire) or a medical emergency, tell them to hang up and call 911 or the appropriate emergency line.

DATA COLLECTION POLICY (strict — this is a compliance requirement):
- You may collect EXACTLY four things: customer name, phone number, service type, and appointment date/time.
- NEVER ask about, record, repeat back, or pass to any tool: credit/debit card numbers, CVV/security codes, bank account or routing numbers, or Social Security numbers. This system never takes payment over the phone or by text.
- If a caller volunteers payment or SSN details, respond once with: "You don't need to share any payment or account details with me — I only need your name, number, service and time." Then continue booking. Do not reference what they shared.

CONVERSATION RULES:
- Be warm, brief, and concrete. One question at a time. Plain sentences — no markdown, no bullet lists (your words are spoken aloud or sent as SMS-style text).
- Resolve relative dates ("this Thursday", "tomorrow morning") to YYYY-MM-DD using today's date and weekday before calling tools. Double-check the weekday of the date you pick matches what the caller asked for.
- Before booking, confirm the full slot back to the caller in one sentence.
- Use check_availability before book_appointment when the caller asks for a specific time.
- Never ask the caller to dictate their phone number. The system automatically books against their caller ID — simply omit phone_number when calling book_appointment. Only pass one if the caller volunteers a different number for the booking.
- After a successful booking, confirm: service, date, time, and business name. Then ask if they need anything else.
- To cancel or reschedule: call find_my_appointments first (it matches by caller ID), read the matched appointment back (service, date, time), and get an explicit yes before calling cancel_appointment. To reschedule, cancel the old appointment and then book the new slot.`;
}

/**
 * createGeminiEngine(options)
 *   - toolExecutor: { execute(name, args, ctx) } from tools/handlers
 *   - generateFn: optional override (contents, systemInstruction) → normalized
 *     { text, functionCalls: [{name, args}] } — used by tests and by any
 *     future model swap. When omitted, the real Gemini SDK is used.
 */
function createGeminiEngine({ tenant, toolExecutor, generateFn }) {
  let client = null;

  function getClient() {
    if (!client) {
      client = config.gemini.useVertex
        ? new GoogleGenAI({
            vertexai: true,
            project: config.gemini.project,
            location: config.gemini.location,
          })
        : new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return client;
  }

  async function generate(contents, systemInstruction) {
    if (generateFn) return generateFn(contents, systemInstruction);

    const response = await getClient().models.generateContent({
      model: config.gemini.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations }],
      },
    });
    const calls = response.functionCalls || [];
    // Only read .text on pure-text turns: runTurn ignores text that accompanies
    // tool calls, and accessing it then makes the SDK log a warning per round.
    return {
      text: calls.length ? '' : (response.text || ''),
      functionCalls: calls.map(c => ({ name: c.name, args: c.args })),
    };
  }

  /**
   * Run one user turn through the model, executing tool calls until the
   * model produces plain text (or MAX_TOOL_ROUNDS is hit).
   * Returns { reply, bookedNow } and mutates session.history / session.facts.
   */
  async function runTurn(session, userText, ctx = {}) {
    const todayISO = (ctx.now || new Date()).toISOString().split('T')[0];
    // Multi-tenant: the conversation's tenant rides in ctx; the constructor
    // tenant is the single-tenant fallback.
    const systemInstruction = buildSystemPrompt(ctx.tenant || tenant, todayISO);

    session.history.push({ role: 'user', parts: [{ text: userText }] });
    compressHistory(session);

    let bookedNow = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { text, functionCalls } = await generate(session.history, systemInstruction);

      if (!functionCalls || functionCalls.length === 0) {
        const reply = (text || '').trim() ||
          "Sorry, I didn't catch that — could you say it again?";
        session.history.push({ role: 'model', parts: [{ text: reply }] });
        return { reply, bookedNow };
      }

      // Record the model's tool-call turn, execute each call, feed results back.
      session.history.push({
        role: 'model',
        parts: functionCalls.map(fc => ({ functionCall: { name: fc.name, args: fc.args } })),
      });

      const responseParts = [];
      for (const fc of functionCalls) {
        safeLog(`🔧 tool call: ${fc.name}`, fc.args);
        const result = await toolExecutor.execute(fc.name, fc.args, ctx);

        if (fc.name === 'book_appointment' && result.confirmed) {
          bookedNow = true;
          Object.assign(session.facts, {
            client_name: result.client_name,
            test_type: result.test_type,
            date: result.date,
            time_slot: result.time_slot,
          });
        }
        responseParts.push({
          functionResponse: { name: fc.name, response: { result } },
        });
      }
      session.history.push({ role: 'user', parts: responseParts });
    }

    const fallback = 'I ran into trouble completing that. Let me try once more — what service would you like to book?';
    session.history.push({ role: 'model', parts: [{ text: fallback }] });
    return { reply: fallback, bookedNow };
  }

  return { runTurn, buildSystemPrompt };
}

module.exports = { createGeminiEngine, buildSystemPrompt };
