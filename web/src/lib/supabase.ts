// Browser Supabase client for the console's durable reads (audit trail,
// call history) and Realtime inserts. Null when env isn't configured —
// pages fall back to the engine's live SSE feed so dev works without keys.
//
// ⚠ Read policies are currently the permissive dev posture defined in
// medlab-engine/src/db/schema.sql. Tenant-scoped RLS lands with Auth.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

// Durable copy of the engine's dashboard event (audit_events table).
export interface AuditRow {
  id: number;
  tenant_id: string | null;
  event_id: string | null;
  type:
    | "call.answered"
    | "booking.confirmed"
    | "booking.cancelled"
    | "guardrail.redacted"
    | "emergency.detected"
    | "optout.received"
    | "optout.restored";
  channel: "voice" | "whatsapp" | "unknown";
  phone_tail: string | null;
  data: {
    booking_id?: number;
    patient_name?: string;
    test_type?: string;
    date?: string;
    time_slot?: string;
    status?: string;
    summary?: string;
    tool?: string;
    code?: string;
  };
  created_at: string;
}
