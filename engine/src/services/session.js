// Per-caller conversation state. Held IN MEMORY ONLY with a TTL — this is a
// deliberate HIPAA design decision: raw transcripts are never persisted.
// The only durable artifacts of a conversation are whitelisted appointment
// rows (db) and redacted audit lines.

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes of inactivity
const MAX_HISTORY_TURNS = 12;          // context-compression threshold

function createSessionStore({ ttlMs = SESSION_TTL_MS } = {}) {
  const sessions = new Map();

  function key(channel, from) {
    return `${channel}:${from}`;
  }

  function get(channel, from) {
    const k = key(channel, from);
    const existing = sessions.get(k);
    if (existing && Date.now() - existing.touchedAt < ttlMs) {
      existing.touchedAt = Date.now();
      return existing;
    }
    const fresh = {
      key: k,
      channel,
      from,
      history: [],        // Gemini `contents` format: { role, parts }
      facts: {},          // structured slots: client_name, test_type, date, time_slot
      completed: false,   // set true once a booking is confirmed
      touchedAt: Date.now(),
    };
    sessions.set(k, fresh);
    return fresh;
  }

  function end(channel, from) {
    sessions.delete(key(channel, from));
  }

  // Opportunistic sweep so long-running processes don't accumulate PHI in RAM.
  function sweep() {
    const now = Date.now();
    for (const [k, s] of sessions) {
      if (now - s.touchedAt >= ttlMs) sessions.delete(k);
    }
  }

  return { get, end, sweep, _sessions: sessions };
}

/**
 * Context compression. When history exceeds MAX_HISTORY_TURNS, collapse
 * everything but the most recent turns into a single deterministic
 * "known facts" line built from the structured slots — never from raw
 * transcript text. Costs zero extra model calls and carries zero
 * unstructured restricted content forward.
 */
function compressHistory(session) {
  if (session.history.length <= MAX_HISTORY_TURNS) return session.history;

  const recent = session.history.slice(-8);
  const f = session.facts;
  const factBits = [
    f.client_name && `customer name: ${f.client_name}`,
    f.test_type && `service: ${f.test_type}`,
    f.date && `date: ${f.date}`,
    f.time_slot && `slot: ${f.time_slot}`,
  ].filter(Boolean);

  const summaryTurn = {
    role: 'user',
    parts: [{
      text:
        `[Conversation summary — earlier turns compressed] ` +
        (factBits.length ? `Confirmed so far: ${factBits.join('; ')}.` : 'No details confirmed yet.'),
    }],
  };

  session.history = [summaryTurn, ...recent];
  return session.history;
}

module.exports = { createSessionStore, compressHistory, MAX_HISTORY_TURNS };
