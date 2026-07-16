// Twilio webhook signature validation (X-Twilio-Signature).
// HMAC-SHA1 over the full webhook URL + alphabetically sorted POST params,
// keyed with the account auth token — per Twilio's security docs.
//
// Opt-in via TWILIO_VALIDATE_WEBHOOKS=true: signature math depends on the
// exact public URL, so it's enabled on the deployed engine (stable domain
// in PUBLIC_BASE_URL) and left off for local curl/tunnel experiments.

const crypto = require('crypto');

function expectedSignature(authToken, url, params) {
  const data =
    url +
    Object.keys(params || {})
      .sort()
      .map((k) => k + params[k])
      .join('');
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Express middleware for /webhook/* routes.
 */
function twilioSignatureGuard({ authToken, publicBaseUrl, enabled }) {
  return (req, res, next) => {
    if (!enabled || !authToken) return next();

    const signature = req.headers['x-twilio-signature'];
    if (!signature) return res.status(403).send('Missing Twilio signature');

    const url = `${publicBaseUrl}${req.originalUrl}`;
    const expected = expectedSignature(authToken, url, req.body);
    if (!safeEqual(expected, String(signature))) {
      return res.status(403).send('Invalid Twilio signature');
    }
    next();
  };
}

module.exports = { twilioSignatureGuard, expectedSignature };
