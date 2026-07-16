// Dashboard feed — read-only API consumed by the front-desk console
// (MedLab Dashboard.dc.html).
//   GET /api/dashboard/state   → { tenant, counters, recent } snapshot
//   GET /api/dashboard/events  → Server-Sent Events: buffer replay, then live
//
// SSE over WebSockets on purpose: the flow is strictly server → dashboard,
// EventSource reconnects for free, and it rides the existing Express server.
//
// ⚠ Unauthenticated and CORS-open for local development (the .dc.html opens
// from file://, so Origin is "null"). Events carry minimum-necessary data
// (patient name + phone tail only), but before exposing this beyond
// localhost put it behind auth and pin the allowed origin.

const express = require('express');
const { createDashboardAuth } = require('../services/dashboardAuth');

function createDashboardRouter({ engine, auth }) {
  const router = express.Router();
  const dashAuth = auth || createDashboardAuth({ store: engine.store });

  router.use('/api/', async (req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'authorization, content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    // Keyless local dev stays open; with Supabase configured, a verified
    // user token is required and pins the tenant scope.
    if (dashAuth.open) return next();
    const result = await dashAuth.resolve(req);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    req.dashboardTenantId = result.tenantId;

    const requested = req.query.tenant ? String(req.query.tenant) : null;
    if (requested && requested !== result.tenantId) {
      return res.status(403).json({ error: 'Token is not a member of that tenant.' });
    }
    next();
  });

  function tenantJson(t) {
    return {
      id: t.id,
      lab_name: t.labName,
      open_hour: t.openHour,
      close_hour: t.closeHour,
      slot_capacity: t.slotCapacity,
    };
  }

  // ?tenant=<id> scopes counters + events to one lab. 404 when the tenant
  // doesn't exist or has no inbound number pointed at this engine — the
  // console renders that as "LINE NOT PROVISIONED" and stays on the durable
  // Supabase trail instead.
  router.get('/api/dashboard/state', async (req, res) => {
    // Authed mode: the token decides the scope, whatever the query says.
    const tenantId = req.dashboardTenantId || req.query.tenant;
    if (!tenantId) {
      const { counters, recent } = engine.events.snapshot();
      return res.json({ tenant: tenantJson(engine.tenant), counters, recent });
    }

    const tenant = await engine.getTenantById(String(tenantId));
    const provisioned =
      tenant &&
      (tenant.id === engine.tenant.id || tenant.twilioNumber || tenant.whatsappNumber);
    if (!provisioned) {
      return res.status(404).json({ error: 'Tenant is not provisioned on this engine.' });
    }

    const { counters, recent } = engine.events.snapshot(tenant.id);
    res.json({ tenant: tenantJson(tenant), counters, recent });
  });

  router.get('/api/dashboard/events', (req, res) => {
    const tenantId =
      req.dashboardTenantId || (req.query.tenant ? String(req.query.tenant) : undefined);

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx et al.)
    });
    if (res.flushHeaders) res.flushHeaders();

    const write = (event) => {
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Replay the ring buffer so a freshly opened console isn't blank,
    // then stream live events as the engine emits them (tenant-scoped
    // when ?tenant= is given).
    for (const event of engine.events.snapshot(tenantId).recent) write(event);
    const unsubscribe = engine.events.subscribe(write, tenantId);

    const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);
    if (heartbeat.unref) heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}

module.exports = { createDashboardRouter };
