// HIPAA guardrail layer — minimum-necessary enforcement.
//
// Three controls, applied in order of authority:
//   1. sanitizeAppointment(): the ONLY path to a database write. Whitelist
//      of allowed fields; anything else is dropped and reported.
//   2. guardToolArgs(): intercepts Gemini function-call payloads BEFORE the
//      backend executes them. Strips unknown keys, rejects any argument
//      value carrying unstructured health-history content.
//   3. safeLog(): all runtime logging routes through PHI redaction.
//      Raw transcripts are never written to disk or database — conversation
//      state lives in memory with a TTL (see services/session.js).

const { redactText, redactObject, containsHealthHistory } = require('./redact');

// The complete set of patient data this system is permitted to store.
// Name, phone, test type, scheduling fields, and operational metadata. Nothing else.
const ALLOWED_APPOINTMENT_FIELDS = new Set([
  'tenant_id',
  'patient_name',
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
    this.code = code || 'PHI_REJECTED';
  }
}

/**
 * Final gate before persistence. Returns { record, dropped } where record
 * contains only whitelisted fields and dropped lists what was excluded.
 * Throws if a whitelisted free-text field itself carries health history.
 */
function sanitizeAppointment(input) {
  const record = {};
  const dropped = [];
  for (const [key, value] of Object.entries(input || {})) {
    if (!ALLOWED_APPOINTMENT_FIELDS.has(key)) {
      dropped.push(key);
      continue;
    }
    if (typeof value === 'string') {
      const hit = containsHealthHistory(value);
      if (hit) {
        throw new ComplianceError(
          `Field "${key}" contains health-history content (matched "${hit}") and cannot be stored.`
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
 * - Health-history content in any value is a hard rejection: the tool
 *   handler returns a structured refusal the model must relay.
 */
function guardToolArgs(toolName, args, allowedKeys) {
  const clean = {};
  const stripped = [];
  for (const [key, value] of Object.entries(args || {})) {
    if (!allowedKeys.includes(key)) {
      stripped.push(key);
      continue;
    }
    if (typeof value === 'string') {
      const hit = containsHealthHistory(value);
      if (hit) {
        throw new ComplianceError(
          `Tool "${toolName}" argument "${key}" contains health-history content. ` +
          `Collection is restricted to name, phone, test type and time.`
        );
      }
    }
    clean[key] = value;
  }
  return { clean, stripped };
}

/**
 * PHI-safe logger. Everything the runtime prints goes through redaction.
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
