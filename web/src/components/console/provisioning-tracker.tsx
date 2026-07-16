"use client";

// Rendered in place of <LiveFeed> on Overview while the tenant is
// 'provisioning_active' — ops is configuring Twilio + the engine out of
// band (scripts/activate-tenant.mjs flips this to 'live_active' when done).
// No push signal for that yet, so "Refresh status" is the honest affordance.

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-gate";

const STEPS = [
  { label: "Card secured", state: "done" },
  { label: "WhatsApp number received", state: "done" },
  { label: "Engine configuration", state: "next" },
  { label: "Test call", state: "todo" },
  { label: "Go live", state: "todo" },
] as const;

export function ProvisioningTracker() {
  const { refreshTenant } = useAuth();
  const [checking, setChecking] = useState(false);

  async function onRefresh() {
    setChecking(true);
    try {
      await refreshTenant();
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="mx-auto flex max-w-md flex-col gap-1 px-6 py-8">
        <h2 className="text-center text-lg font-bold tracking-tight">Configuring your engine</h2>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">
          We&apos;ll reach out as soon as your line is live — usually within one business day.
        </p>

        <div className="mt-5 flex flex-col">
          {STEPS.map((step) => (
            <div
              key={step.label}
              className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 first:border-t-0 dark:border-slate-800"
            >
              <span
                className={
                  step.state === "done"
                    ? "grid size-4.5 place-items-center rounded-full bg-green-100 text-[10px] font-bold text-green-700 dark:bg-green-500/15 dark:text-green-300"
                    : step.state === "next"
                      ? "grid size-4.5 place-items-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                      : "grid size-4.5 place-items-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-300 dark:border-slate-600 dark:text-slate-600"
                }
              >
                {step.state === "done" ? "✓" : ""}
              </span>
              <span
                className={`text-sm ${step.state === "todo" ? "text-slate-400 dark:text-slate-500" : "font-medium"}`}
              >
                {step.label}
              </span>
              {step.state === "next" ? (
                <span className="ml-auto font-mono text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                  IN PROGRESS
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <button
          onClick={() => void onRefresh()}
          disabled={checking}
          className="mt-5 rounded-lg border border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {checking ? "Checking…" : "Refresh status"}
        </button>
      </div>
    </section>
  );
}
