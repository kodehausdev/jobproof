// Auth for the dashboard feed (/api/dashboard/*).
//
// Mode is decided by configuration, not request:
//   open   — no Supabase configured (bare local dev, memory store): the
//            console has no auth either, endpoints stay open on localhost.
//   authed — Supabase configured: every request must carry a Supabase user
//            access token (Authorization: Bearer … or ?token=…, because
//            EventSource cannot set headers). The token is verified against
//            Supabase Auth and mapped to the caller's tenant via profiles —
//            the same mapping RLS uses, so the dashboard can never be
//            scoped to a tenant the user doesn't belong to.
//
// Verified tokens are cached briefly to keep webhook-adjacent latency off
// the auth server.

const config = require('../config');
const { safeLog } = require('../compliance/hipaa');

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

function createDashboardAuth({ store } = {}) {
  const supabaseUrl = config.supabase.url;
  const supabaseKey = config.supabase.key;
  // Open when there's nothing to verify against: no Supabase config, or an
  // in-memory store (no profiles table → no tenant mapping possible).
  const open = !supabaseUrl || !supabaseKey || store?.kind !== 'supabase';
  const cache = new Map(); // token → { tenantId, at }

  async function verifyToken(token) {
    const cached = cache.get(token);
    if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.tenantId;

    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;

    const tenantId = await store.getProfileTenant(user.id);
    if (!tenantId) return null;

    cache.set(token, { tenantId, at: Date.now() });
    if (cache.size > 500) cache.clear(); // crude bound; tokens re-verify
    return tenantId;
  }

  /**
   * resolve(req) → { ok: true, tenantId } | { ok: false, status, error }
   */
  async function resolve(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : (req.query.token ? String(req.query.token) : null);

    if (!token) {
      return { ok: false, status: 401, error: 'Missing dashboard token.' };
    }

    let tenantId = null;
    try {
      tenantId = await verifyToken(token);
    } catch (err) {
      safeLog(`⚠️ dashboard auth failed: ${err.message}`);
      return { ok: false, status: 503, error: 'Auth backend unavailable.' };
    }
    if (!tenantId) {
      return { ok: false, status: 401, error: 'Invalid token or no tenant membership.' };
    }
    return { ok: true, tenantId };
  }

  return { open, resolve };
}

module.exports = { createDashboardAuth };
