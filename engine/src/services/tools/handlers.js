// Backend execution functions for Gemini tool calls.
// Every call passes through hipaa.guardToolArgs first; book_appointment
// additionally passes through hipaa.sanitizeAppointment before the store.

const {
  guardToolArgs, sanitizeAppointment, ComplianceError, safeLog,
} = require('../../compliance/hipaa');
const { notifyOwner } = require('../twilio');
const { TOOL_ARG_WHITELIST, TEST_CATALOG } = require('./schemas');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^([01]\d|2[0-3]):(00|30)$/;

function normalizeTestType(input) {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  const hit = TEST_CATALOG.find(
    t => t.name.toLowerCase() === q ||
         t.code.toLowerCase() === q ||
         t.name.toLowerCase().includes(q) ||
         q.includes(t.name.toLowerCase())
  );
  return hit ? hit.name : null;
}

function buildDaySlots(tenant) {
  const slots = [];
  for (let h = tenant.openHour; h < tenant.closeHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

/**
 * createToolHandlers({ store, tenant, events, notify }) → { execute(name, args, ctx) }
 * ctx carries per-conversation facts the model shouldn't have to restate:
 * the caller's phone from Twilio caller ID, and — multi-tenant — the tenant
 * this conversation belongs to (ctx.tenant; the constructor tenant is the
 * single-tenant fallback).
 * events (optional) is the dashboard bus from services/events.
 * notify (optional) is (tenant, message) => Promise — texts the owner on a
 * confirmed booking; defaults to compliance/twilio's notifyOwner, override
 * in tests to assert on it without hitting the network.
 */
function createToolHandlers({ store, tenant: defaultTenant, events, notify }) {
  const bus = events || { emit: () => {} };
  const notifyFn = notify || notifyOwner;
  const handlers = {
    async list_available_tests() {
      return {
        tests: TEST_CATALOG.map(t => ({ name: t.name, duration_minutes: t.duration_min })),
      };
    },

    async check_availability(args, ctx = {}) {
      const tenant = ctx.tenant || defaultTenant;
      const { date, time_slot } = args;
      if (!DATE_RE.test(date || '')) {
        return { error: 'Invalid date. Expected YYYY-MM-DD.' };
      }
      const allSlots = buildDaySlots(tenant);
      const wanted = time_slot ? [time_slot] : allSlots;
      if (time_slot && !SLOT_RE.test(time_slot)) {
        return { error: 'Invalid time_slot. Expected HH:MM on a 30-minute boundary.' };
      }

      const taken = await store.bookingsOn(tenant.id, date);
      const countBySlot = {};
      for (const b of taken) {
        countBySlot[b.time_slot] = (countBySlot[b.time_slot] || 0) + 1;
      }

      const open = wanted.filter(
        s => allSlots.includes(s) && (countBySlot[s] || 0) < tenant.slotCapacity
      );

      return {
        date,
        open_slots: open,
        requested_slot_available: time_slot ? open.includes(time_slot) : undefined,
      };
    },

    async book_appointment(args, ctx = {}) {
      const tenant = ctx.tenant || defaultTenant;
      const { client_name, phone_number, test_type, date, time_slot } = args;

      if (!DATE_RE.test(date || '')) return { error: 'Invalid date. Expected YYYY-MM-DD.' };
      if (!SLOT_RE.test(time_slot || '')) {
        return { error: 'Invalid time_slot. Expected HH:MM on a 30-minute boundary.' };
      }
      if (!client_name?.trim()) return { error: 'client_name is required.' };

      const canonicalTest = normalizeTestType(test_type);
      if (!canonicalTest) {
        return {
          error: `Unknown service "${test_type}". Offer the caller one of: ${TEST_CATALOG.map(t => t.name).join(', ')}.`,
        };
      }

      const phone = (phone_number || ctx.callerPhone || '').replace(/^whatsapp:/, '').trim();
      if (!phone) return { error: 'phone_number is required.' };

      const booked = await store.countBookings(tenant.id, date, time_slot);
      if (booked >= tenant.slotCapacity) {
        return { error: `The ${time_slot} slot on ${date} is full. Offer a nearby open slot.` };
      }

      // Minimum-necessary gate: whitelist-only write.
      const { record, dropped } = sanitizeAppointment({
        tenant_id: tenant.id,
        client_name: client_name.trim(),
        phone_number: phone,
        test_type: canonicalTest,
        date,
        time_slot,
        channel: ctx.channel || 'unknown',
        status: 'confirmed',
        created_at: new Date().toISOString(),
      });
      if (dropped.length) safeLog('⚠️ sanitizeAppointment dropped fields:', dropped.join(','));

      const saved = await store.insertAppointment(record);
      safeLog(`✅ Booking #${saved.id} — ${canonicalTest} ${date} ${time_slot} [${tenant.id}]`);

      bus.emit('booking.confirmed', { channel: ctx.channel, phone, tenantId: tenant.id }, {
        booking_id: saved.id,
        client_name: record.client_name,
        test_type: canonicalTest,
        date,
        time_slot,
        status: 'confirmed',
        summary: `${canonicalTest} booked for ${date} at ${time_slot}; confirmed over ${ctx.channel || 'phone'}.`,
      });

      // Fire-and-forget: a slow or failed owner text must never delay or
      // break the caller's own booking confirmation.
      notifyFn(
        tenant,
        `New booking: ${record.client_name} — ${canonicalTest} on ${date} at ${time_slot} (via ${ctx.channel || 'phone'}).`
      ).catch(err => safeLog(`⚠️ owner notify failed: ${err.message}`));

      return {
        confirmed: true,
        booking_id: saved.id,
        client_name: record.client_name,
        test_type: canonicalTest,
        date,
        time_slot,
        lab_name: tenant.labName,
      };
    },

    async find_my_appointments(_args, ctx = {}) {
      const tenant = ctx.tenant || defaultTenant;
      const phone = (ctx.callerPhone || '').replace(/^whatsapp:/, '').trim();
      if (!phone) return { appointments: [], note: 'No caller ID available for this conversation.' };

      const today = (ctx.now || new Date()).toISOString().split('T')[0];
      const rows = await store.findUpcomingAppointments(tenant.id, phone, today);
      return {
        appointments: rows.map(a => ({
          booking_id: a.id,
          test_type: a.test_type,
          date: a.date,
          time_slot: a.time_slot,
        })),
        note: rows.length
          ? undefined
          : 'No upcoming appointments found for this phone number.',
      };
    },

    async cancel_appointment(args, ctx = {}) {
      const tenant = ctx.tenant || defaultTenant;
      const phone = (ctx.callerPhone || '').replace(/^whatsapp:/, '').trim();
      const bookingId = Number(args.booking_id);
      if (!Number.isInteger(bookingId)) {
        return { error: 'booking_id must be a number from find_my_appointments.' };
      }

      // Ownership check: the id must be among the CALLER's own upcoming
      // appointments (matched by caller ID) — ids can't be guessed to
      // cancel someone else's booking.
      const today = (ctx.now || new Date()).toISOString().split('T')[0];
      const mine = await store.findUpcomingAppointments(tenant.id, phone, today);
      const target = mine.find(a => a.id === bookingId);
      if (!target) {
        return { error: 'That booking was not found among this caller\'s upcoming appointments. Use find_my_appointments first.' };
      }

      await store.updateAppointmentStatus(tenant.id, bookingId, 'cancelled');
      safeLog(`🗑️ Booking #${bookingId} cancelled — ${target.test_type} ${target.date} ${target.time_slot} [${tenant.id}]`);

      bus.emit('booking.cancelled', { channel: ctx.channel, phone, tenantId: tenant.id }, {
        booking_id: bookingId,
        test_type: target.test_type,
        date: target.date,
        time_slot: target.time_slot,
        status: 'cancelled',
        summary: `${target.test_type} on ${target.date} at ${target.time_slot} cancelled over ${ctx.channel || 'phone'}.`,
      });

      return {
        cancelled: true,
        booking_id: bookingId,
        test_type: target.test_type,
        date: target.date,
        time_slot: target.time_slot,
        lab_name: tenant.labName,
      };
    },
  };

  return {
    /**
     * Guarded dispatch: strips non-whitelisted args, rejects restricted
     * content, executes, and always returns a JSON-serializable result the
     * model can consume as a functionResponse.
     */
    async execute(name, rawArgs, ctx) {
      const handler = handlers[name];
      if (!handler) return { error: `Unknown tool: ${name}` };

      try {
        const { clean, stripped } = guardToolArgs(name, rawArgs, TOOL_ARG_WHITELIST[name] || []);
        if (stripped.length) {
          safeLog(`🛡️ [${name}] stripped non-whitelisted args:`, stripped.join(','));
        }
        return await handler(clean, ctx);
      } catch (err) {
        if (err instanceof ComplianceError) {
          safeLog(`🛡️ ComplianceError in ${name}: ${err.message}`);
          // Dashboard event carries only the fact of interception — no caller
          // content, no matched term (see services/events.js).
          bus.emit('guardrail.redacted', {
            channel: ctx?.channel,
            phone: ctx?.callerPhone,
            tenantId: ctx?.tenant?.id || defaultTenant?.id,
          }, {
            tool: name,
            code: err.code,
            status: 'guardrail_redacted',
            summary:
              'Caller volunteered restricted payment or identity information mid-call. ' +
              'Intercepted by the compliance layer — nothing was stored or executed.',
          });
          return {
            error:
              'Rejected: this system only collects name, phone number, service type and appointment time. ' +
              'Do not collect or restate payment card numbers, CVVs, bank details, or SSNs. Tell the caller those details are not needed for booking.',
          };
        }
        safeLog(`❌ Tool ${name} failed: ${err.message}`);
        return { error: 'Internal error executing that action. Apologize and offer to try again.' };
      }
    },
  };
}

module.exports = { createToolHandlers, normalizeTestType, buildDaySlots };
