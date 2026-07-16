"use client";

// Rendered in place of <LiveFeed> on Overview while the tenant is
// 'provisioning_pending_number' — self-serve WhatsApp number submission.
// Advances the tenant to 'provisioning_active' on success.

import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

export function NumberIntake() {
  const { refreshTenant } = useAuth();
  const [number, setNumber] = useState("");
  const [confirmedUnregistered, setConfirmedUnregistered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/whatsapp-number", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          whatsapp_number: number.trim(),
          confirmed_unregistered: confirmedUnregistered,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save number.");
      await refreshTenant();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="mx-auto flex max-w-md flex-col gap-3.5 px-6 py-10 text-center">
        <h2 className="text-lg font-bold tracking-tight">Connect your WhatsApp line</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your card is on file — no charge yet. Give us the WhatsApp Business number your
          patients text, and we&apos;ll start configuring your engine instance.
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-left text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="font-bold">Must be a number with no WhatsApp history.</span> WhatsApp
          Business API registration fails on any number that already has (or ever had) a personal
          or Business app account. If this SIM has WhatsApp installed, delete that account first —
          otherwise use a fresh number.
        </div>
        <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-3 text-left">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
            WhatsApp Business number
            <input
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+14155551234"
              className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
            />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
            <input
              required
              type="checkbox"
              checked={confirmedUnregistered}
              onChange={(e) => setConfirmedUnregistered(e.target.checked)}
              className="mt-0.5"
            />
            I confirm this number has never been registered to WhatsApp (or its existing account
            has been deleted).
          </label>
          {error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Submit number"}
          </button>
        </form>
      </div>
    </section>
  );
}
