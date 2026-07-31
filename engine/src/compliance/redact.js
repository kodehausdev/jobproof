// Sensitive-content detection and redaction primitives.
// Everything that touches a log line, an error message, or a stored string
// passes through here first. Redaction is best-effort defense in depth —
// the primary control is that transcripts are never persisted at all
// (see hipaa.js).
//
// This is trades-appropriate PII protection, not a health-data (PHI) guard:
// Jobproof isn't a covered entity and has no HIPAA obligation. The two
// categories that actually matter for a home-service receptionist are
// payment-card numbers and SSNs a caller might blurt out mid-call — a
// service address, by contrast, is legitimate business data (a tech has to
// be dispatched there), so it's kept out of plaintext logs but never
// rejected the way a card number is.

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
// 13-19 digits, optionally grouped in blocks separated by spaces or dashes —
// covers Visa/Mastercard/Discover (16) and Amex (15) formats.
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
const CVV_RE = /\b(?:cvv|cvc|security code)\s*[:\s]*\d{3,4}\b/i;

const PHI_PATTERNS = [
  { re: new RegExp(SSN_RE, 'g'), tag: 'SSN' },
  { re: new RegExp(CARD_RE, 'g'), tag: 'CARD' },
  { re: new RegExp(CVV_RE, 'gi'), tag: 'CVV' },
  // Email addresses
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, tag: 'EMAIL' },
  // Street addresses (house number + street suffix)
  { re: /\b\d{1,5}\s+[A-Za-z0-9.\s]{3,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b\.?/gi, tag: 'ADDRESS' },
];

// Phrases that signal a caller is about to recite payment or identity info,
// even before a full matching digit sequence appears (voice STT sometimes
// renders spoken-digit-by-digit numbers as words, not a clean digit run).
const RESTRICTED_CONTEXT_TERMS = [
  'card number', 'credit card', 'debit card', 'cvv', 'cvc', 'security code',
  'routing number', 'bank account number', 'social security number', 'my ssn',
];

// Phone numbers are operationally required (it's how we call customers back),
// so in logs we mask all but the last 4 digits rather than dropping them.
// Bounded on both sides by "not a letter": Twilio SIDs (e.g. Account SIDs)
// are long hex strings that frequently contain 9+ consecutive digits by
// chance — without the boundary this regex mangles them mid-string, which
// corrupts exactly the diagnostic detail (the SID) an admin needs to look
// up the failure in the Twilio console.
const PHONE_RE = /(?<![a-zA-Z])(\+?\d[\d\s\-().]{7,}\d)(?![a-zA-Z])/g;

function maskPhone(match) {
  const digits = match.replace(/\D/g, '');
  // 9+ digits: phone numbers mask; ISO dates (8 digits) stay readable in logs.
  if (digits.length < 9) return match;
  return `[PHONE-****${digits.slice(-4)}]`;
}

/**
 * Redact sensitive content from free text. Used on every log line and every
 * string that would otherwise leave the request scope.
 */
function redactText(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const { re, tag } of PHI_PATTERNS) {
    out = out.replace(re, `[REDACTED-${tag}]`);
  }
  out = out.replace(PHONE_RE, maskPhone);
  return out;
}

/**
 * Detect content that must never be collected or stored by this system —
 * payment-card numbers, CVVs, SSNs. Returns the matched term for
 * diagnostics (the term itself is generic, never the caller's actual text).
 */
function containsRestrictedContent(text) {
  if (typeof text !== 'string' || !text) return null;
  if (CARD_RE.test(text)) return 'card number';
  if (CVV_RE.test(text)) return 'card security code';
  if (SSN_RE.test(text)) return 'SSN';
  const lower = text.toLowerCase();
  for (const term of RESTRICTED_CONTEXT_TERMS) {
    if (lower.includes(term)) return term;
  }
  return null;
}

/**
 * Deep-redact every string value in an object (for structured payload logs).
 */
function redactObject(obj) {
  if (obj == null) return obj;
  if (typeof obj === 'string') return redactText(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactObject(v);
    return out;
  }
  return obj;
}

module.exports = { redactText, redactObject, containsRestrictedContent };
