// Privacy guardrail layer — minimum-necessary enforcement for a trades
// receptionist (no HIPAA obligation here; see compliance/redact.js for why
// the checks target payment-card/SSN content instead of health data).
//
// Three controls, applied in order of authority:
//   1. sanitizeAppointment(): the ONLY path to a database write. Whitelist
//      of allowed fields; anything else is dropped and reported.
//   2. guardToolArgs(): intercepts Gemini function-call payloads BEFORE the
//      backend executes them. Strips unknown keys, rejects any argument
//      value carrying a payment-card number, CVV, or SSN.
//   3. safeLog(): all runtime logging routes through redaction.
//      Raw transcripts are never written to disk or database — conversation
//      state lives in memory with a TTL (see services/session.js).

const { redactText, redactObject, containsRestrictedContent } = require('./redact');

// The complete set of customer data this system is permitted to store.
// Name, phone, service type, scheduling fields, and operational metadata.
// Nothing else — in particular, no payment details ever land here.
const ALLOWED_APPOINTMENT_FIELDS = new Set([
  'tenant_id',
  'client_name',
  'phone_number',
  'test_type',
  'date',
  'time_slot',
  'channel',
  'status',
  'created_at',
]);

class ComplianceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code || 'RESTRICTED_CONTENT_REJECTED';
  }
}

// Fields that are system-populated (from Twilio caller ID, server clock,
// etc.) rather than typed by the caller or the model, and so are exempt
// from the restricted-content scan. phone_number in particular is a
// legitimate long digit string by definition — the card-number pattern
// (any 13-19 digit run) routinely false-positives on real E.164 numbers,
// e.g. a 13-digit Nigerian number (+234...). The scan still applies to
// every other field, where a caller could leak a card number into free text.
const TRUSTED_NUMERIC_FIELDS = new Set(['phone_number']);

/**
 * Final gate before persistence. Returns { record, dropped } where record
 * contains only whitelisted fields and dropped lists what was excluded.
 * Throws if a whitelisted free-text field itself carries restricted content
 * (a payment-card number, CVV, or SSN).
 */
function sanitizeAppointment(input) {
  const record = {};
  const dropped = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (!ALLOWED_APPOINTMENT_FIELDS.has(key)) {
      dropped.push(key);
      continue;
    }
    if (typeof value === 'string' && !TRUSTED_NUMERIC_FIELDS.has(key)) {
      const hit = containsRestrictedContent(value);
      if (hit) {
        throw new ComplianceError(
          `Field "${key}" contains restricted content (matched "${hit}") and cannot be stored.`
        );
      }
      record[key] = value.trim();
    } else {
      record[key] = value;
    }
  }
  return { record, dropped };
}

/**
 * Intercepts Gemini tool-call arguments before execution.
 * - Unknown keys are silently stripped (model hallucinated a field).
 * - A payment-card number, CVV, or SSN in any value is a hard rejection:
 *   the tool handler returns a structured refusal the model must relay.
 */
function guardToolArgs(toolName, args, allowedKeys) {
  const clean = {};
  const stripped = [];
  for (const [key, value] of Object.entries(args || {})) {
    if (!allowedKeys.includes(key)) {
      stripped.push(key);
      continue;
    }
    if (typeof value === 'string' && !TRUSTED_NUMERIC_FIELDS.has(key)) {
      const hit = containsRestrictedContent(value);
      if (hit) {
        throw new ComplianceError(
          `Tool "${toolName}" argument "${key}" contains restricted content. ` +
          `Collection is restricted to name, phone, service type and time.`
        );
      }
    }
    clean[key] = value;
  }
  return { clean, stripped };
}

/**
 * Redaction-safe logger. Everything the runtime prints goes through
 * redaction before it hits the console.
 */
function safeLog(...parts) {
  const rendered = parts.map(p =>
    typeof p === 'string' ? redactText(p) : JSON.stringify(redactObject(p))
  );
  console.log(...rendered);
}

/**
 * Express middleware: strips request bodies from error traces and tags the
 * request with a redacted, log-safe summary so downstream handlers never
 * log raw payloads by accident.
 */
function phiRequestGuard(req, _res, next) {
  const from = req.body?.From || req.body?.from || 'unknown';
  req.safeSummary = redactText(`${req.method} ${req.path} from=${from}`);
  next();
}

module.exports = {
  ALLOWED_APPOINTMENT_FIELDS,
  ComplianceError,
  sanitizeAppointment,
  guardToolArgs,
  safeLog,
  phiRequestGuard,
};
