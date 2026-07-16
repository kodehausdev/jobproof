// PHI detection and redaction primitives.
// Everything that touches a log line, an error message, or a stored string
// passes through here first. Redaction is best-effort defense in depth —
// the primary control is that transcripts are never persisted at all
// (see hipaa.js).

const PHI_PATTERNS = [
  // US Social Security numbers
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, tag: 'SSN' },
  // Dates of birth in common formats when preceded by dob/birth context
  { re: /\b(?:dob|date of birth|born(?: on)?)[:\s]*[\d\/\-\.]{6,10}\b/gi, tag: 'DOB' },
  // Insurance / policy / member identifiers
  { re: /\b(?:policy|member|insurance|medicaid|medicare)\s*(?:id|no|number|#)?[:\s]*[A-Z0-9\-]{6,}\b/gi, tag: 'INSURANCE_ID' },
  // Email addresses
  { re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, tag: 'EMAIL' },
  // Street addresses (house number + street suffix)
  { re: /\b\d{1,5}\s+[A-Za-z0-9.\s]{3,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b\.?/gi, tag: 'ADDRESS' },
  // Medical record numbers
  { re: /\b(?:mrn|medical record)\s*(?:no|number|#)?[:\s]*[A-Z0-9\-]{4,}\b/gi, tag: 'MRN' },
];

// Phone numbers are operationally required (it's how we call patients back),
// so in logs we mask all but the last 4 digits rather than dropping them.
// Bounded on both sides by "not a letter": Twilio SIDs (e.g. Account SIDs)
// are long hex strings that frequently contain 9+ consecutive digits by
// chance — without the boundary this regex mangles them mid-string, which
// corrupts exactly the diagnostic detail (the SID) an admin needs to look
// up the failure in the Twilio console.
const PHONE_RE = /(?<![a-zA-Z])(\+?\d[\d\s\-().]{7,}\d)(?![a-zA-Z])/g;

// Terms that signal unstructured health history / diagnosis content.
// If a caller volunteers this, the engine acknowledges without recording it.
const HEALTH_HISTORY_TERMS = [
  'diagnos', 'diabet', 'cancer', 'tumor', 'hiv', 'aids', 'hepatitis',
  'pregnan', 'medication', 'prescri', 'metformin', 'insulin', 'chemo',
  'therapy', 'psychiatr', 'depress', 'anxiety', 'bipolar', 'std', 'sti',
  'symptom', 'condition i have', 'my doctor said', 'medical history',
  'blood pressure', 'hypertens', 'cholesterol level', 'disease', 'infection',
  'surgery', 'allerg', 'asthma', 'epilep', 'kidney', 'liver failure',
];

function maskPhone(match) {
  const digits = match.replace(/\D/g, '');
  // 9+ digits: phone numbers mask; ISO dates (8 digits) stay readable in logs.
  if (digits.length < 9) return match;
  return `[PHONE-****${digits.slice(-4)}]`;
}

/**
 * Redact PHI from free text. Used on every log line and every string that
 * would otherwise leave the request scope.
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
 * Detect unstructured health-history content. Returns the first matched
 * term for diagnostics (the term itself is generic, not the patient's text).
 */
function containsHealthHistory(text) {
  if (typeof text !== 'string' || !text) return null;
  const lower = text.toLowerCase();
  for (const term of HEALTH_HISTORY_TERMS) {
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

module.exports = { redactText, redactObject, containsHealthHistory };
