// Types for the Jobproof engine dashboard feed.
// Envelope contract: engine/src/services/events.js

export const ENGINE_URL =
  process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:3000";

export type EventType =
  | "call.answered"
  | "booking.confirmed"
  | "booking.cancelled"
  | "guardrail.redacted"
  | "emergency.detected"
  | "optout.received"
  | "optout.restored";

export interface DashboardEvent {
  id: string; // "evt-7" — monotonic per engine process
  type: EventType;
  ts: string; // ISO timestamp
  tenant_id: string;
  channel: "voice" | "whatsapp" | "unknown";
  phone_tail: string | null; // last 4 digits only
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
}

export interface Counters {
  calls_answered: number;
  bookings_confirmed: number;
  guardrail_events: number;
  emergency_events: number;
}

export interface EngineState {
  tenant: {
    id: string;
    lab_name: string;
    open_hour: number;
    close_hour: number;
    slot_capacity: number;
    // Only populated for authed tenants (see auth-gate.tsx) — the engine's
    // own /api/dashboard/state doesn't return these.
    onboarding_state?: string;
    whatsapp_number?: string | null;
    subscription_status?: string;
    timezone?: string;
  };
  counters: Counters;
  recent: DashboardEvent[];
}

export function eventSeq(ev: DashboardEvent): number {
  return Number(ev.id.split("-")[1] ?? 0);
}
