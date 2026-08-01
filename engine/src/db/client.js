// Datastore abstraction. When SUPABASE_URL is configured, appointments live
// in Postgres; otherwise an in-memory store backs local dev and the test
// suite. Both implement the same three methods, and BOTH are fed exclusively
// through hipaa.sanitizeAppointment() by the tool layer.

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

function createMemoryStore() {
  const appointments = [];
  const auditEvents = [];
  const optOuts = new Set(); // `${tenantId}|${phone}`
  return {
    kind: 'memory',
    appointments, // exposed for test assertions
    auditEvents,  // exposed for test assertions

    async setOptOut(tenantId, phone, optedOut) {
      const k = `${tenantId}|${phone}`;
      if (optedOut) optOuts.add(k);
      else optOuts.delete(k);
    },

    async isOptedOut(tenantId, phone) {
      return optOuts.has(`${tenantId}|${phone}`);
    },

    async insertAppointment(record) {
      const row = { id: appointments.length + 1, ...record };
      appointments.push(row);
      return row;
    },

    async insertAuditEvent(row) {
      auditEvents.push({ id: auditEvents.length + 1, ...row });
    },

    // Memory store starts empty every process — nothing to rehydrate.
    async auditSeed() {
      return null;
    },

    async countBookings(tenantId, date, timeSlot) {
      return appointments.filter(
        a => a.tenant_id === tenantId && a.date === date &&
             a.time_slot === timeSlot && a.status === 'confirmed'
      ).length;
    },

    async bookingsOn(tenantId, date) {
      return appointments.filter(
        a => a.tenant_id === tenantId && a.date === date && a.status === 'confirmed'
      );
    },

    async findUpcomingAppointments(tenantId, phone, fromDate) {
      return appointments
        .filter(
          a => a.tenant_id === tenantId && a.phone_number === phone &&
               a.status === 'confirmed' && a.date >= fromDate
        )
        .sort((a, b) => (a.date + a.time_slot).localeCompare(b.date + b.time_slot));
    },

    async updateAppointmentStatus(tenantId, id, status) {
      const row = appointments.find(a => a.id === id && a.tenant_id === tenantId);
      if (!row) return null;
      row.status = status;
      return row;
    },

    // Memory store has no tenant table — the engine falls back to its
    // env-configured default tenant. Tests inject overrides for routing.
    async getTenantByNumber() {
      return null;
    },

    async getTenantById() {
      return null;
    },

    async getProfileTenant() {
      return null;
    },
  };
}

// Supabase tenant row → the engine's tenant shape (camelCase).
function mapTenantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    labName: row.lab_name,
    timezone: row.timezone,
    openHour: row.open_hour,
    closeHour: row.close_hour,
    slotCapacity: row.slot_capacity,
    twilioNumber: row.twilio_number || null,
    whatsappNumber: row.whatsapp_number || null,
    notifyPhone: row.notify_phone || null,
  };
}

function createSupabaseStore() {
  const supabase = createClient(config.supabase.url, config.supabase.key);
  return {
    kind: 'supabase',

    async setOptOut(tenantId, phone, optedOut) {
      const { error } = await supabase
        .from('optouts')
        .upsert(
          { tenant_id: tenantId, phone_number: phone, opted_out: optedOut, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,phone_number' }
        );
      if (error) throw new Error(`Supabase opt-out upsert failed: ${error.message}`);
    },

    async isOptedOut(tenantId, phone) {
      const { data, error } = await supabase
        .from('optouts')
        .select('opted_out')
        .eq('tenant_id', tenantId).eq('phone_number', phone)
        .maybeSingle();
      if (error) throw new Error(`Supabase opt-out lookup failed: ${error.message}`);
      return Boolean(data?.opted_out);
    },

    async insertAppointment(record) {
      const { data, error } = await supabase
        .from('appointments').insert([record]).select().single();
      if (error) throw new Error(`Supabase insert failed: ${error.message}`);
      return data;
    },

    async insertAuditEvent(row) {
      const { error } = await supabase.from('audit_events').insert([row]);
      if (error) throw new Error(`Supabase audit insert failed: ${error.message}`);
    },

    // Feed rehydration at boot: last 50 events for the ring buffer, plus
    // { tenant_id, type } across all history for the counters. The tallies
    // fetch is bounded rather than aggregated (PostgREST has no group-by);
    // fine at receptionist volumes, revisit past ~10k events.
    async auditSeed() {
      const [recent, tallies] = await Promise.all([
        supabase
          .from('audit_events')
          .select('id, tenant_id, event_id, type, channel, phone_tail, data, created_at')
          .order('id', { ascending: false })
          .limit(50),
        supabase
          .from('audit_events')
          .select('tenant_id, type')
          .order('id', { ascending: false })
          .limit(10000),
      ]);
      const error = recent.error || tallies.error;
      if (error) throw new Error(`Supabase audit seed failed: ${error.message}`);
      return { recent: recent.data || [], tallies: tallies.data || [] };
    },

    async countBookings(tenantId, date, timeSlot) {
      const { count, error } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('date', date)
        .eq('time_slot', timeSlot).eq('status', 'confirmed');
      if (error) throw new Error(`Supabase count failed: ${error.message}`);
      return count || 0;
    },

    async bookingsOn(tenantId, date) {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, date, time_slot, test_type, status')
        .eq('tenant_id', tenantId).eq('date', date).eq('status', 'confirmed');
      if (error) throw new Error(`Supabase select failed: ${error.message}`);
      return data || [];
    },

    async findUpcomingAppointments(tenantId, phone, fromDate) {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, phone_number, test_type, date, time_slot, status')
        .eq('tenant_id', tenantId).eq('phone_number', phone)
        .eq('status', 'confirmed').gte('date', fromDate)
        .order('date').order('time_slot');
      if (error) throw new Error(`Supabase select failed: ${error.message}`);
      return data || [];
    },

    async updateAppointmentStatus(tenantId, id, status) {
      const { data, error } = await supabase
        .from('appointments')
        .update({ status })
        .eq('tenant_id', tenantId).eq('id', id)
        .select().maybeSingle();
      if (error) throw new Error(`Supabase update failed: ${error.message}`);
      return data;
    },

    async getTenantByNumber(number) {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .or(`twilio_number.eq.${number},whatsapp_number.eq.${number}`)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Supabase tenant lookup failed: ${error.message}`);
      return mapTenantRow(data);
    },

    async getTenantById(id) {
      const { data, error } = await supabase
        .from('tenants').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Supabase tenant lookup failed: ${error.message}`);
      return mapTenantRow(data);
    },

    async getProfileTenant(userId) {
      const { data, error } = await supabase
        .from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(`Supabase profile lookup failed: ${error.message}`);
      return data ? data.tenant_id : null;
    },
  };
}

function createStore() {
  return config.supabase.url && config.supabase.key
    ? createSupabaseStore()
    : createMemoryStore();
}

module.exports = { createStore, createMemoryStore };
