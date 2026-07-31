"use client";

import { useState } from "react";
import { useAuth, type AuthTenant } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";
import { US_TIMEZONES } from "@/lib/timezones";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number) {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

export default function SettingsPage() {
  const { user, tenant, refreshTenant } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
          Lab identity and the hours/capacity the AI receptionist schedules against.
        </p>
      </div>

      {!user || !tenant ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4.5 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/60">
          Sign in to a provisioned lab account to edit settings.
        </div>
      ) : (
        // Keyed by tenant.id so the form's local state initializes fresh
        // from props on mount instead of syncing via an effect.
        <SettingsForm key={tenant.id} tenant={tenant} onSaved={refreshTenant} />
      )}
    </div>
  );
}

function SettingsForm({
  tenant,
  onSaved,
}: {
  tenant: AuthTenant;
  onSaved: () => Promise<void>;
}) {
  const initialTimezone = tenant.timezone ?? US_TIMEZONES[0].value;
  const [labName, setLabName] = useState(tenant.lab_name);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [openHour, setOpenHour] = useState(tenant.open_hour);
  const [closeHour, setCloseHour] = useState(tenant.close_hour);
  const [slotCapacity, setSlotCapacity] = useState(tenant.slot_capacity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    labName !== tenant.lab_name ||
    timezone !== initialTimezone ||
    openHour !== tenant.open_hour ||
    closeHour !== tenant.close_hour ||
    slotCapacity !== tenant.slot_capacity;

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/update", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          lab_name: labName,
          timezone,
          open_hour: openHour,
          close_hour: closeHour,
          slot_capacity: slotCapacity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save settings.");
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Lab name
          <input
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            maxLength={120}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          />
        </label>

        <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Timezone
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          >
            {US_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Opens at
            <select
              value={openHour}
              onChange={(e) => setOpenHour(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Closes at
            <select
              value={closeHour}
              onChange={(e) => setCloseHour(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Jobs per slot
          <input
            type="number"
            min={1}
            max={20}
            value={slotCapacity}
            onChange={(e) => setSlotCapacity(Number(e.target.value))}
            className="mt-1.5 w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          />
          <span className="mt-1 block text-[11px] font-normal text-slate-400 dark:text-slate-500">
            How many jobs the AI can book into the same 30-minute slot — drives the Scheduling grid directly.
          </span>
        </label>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {saved && !dirty ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            Saved.
          </div>
        ) : null}

        <button
          onClick={() => void onSave()}
          disabled={!dirty || busy || openHour >= closeHour}
          className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>

      <div className="mt-4 max-w-[560px] rounded-xl border border-slate-200 bg-slate-50 px-4.5 py-3.5 text-[11.5px] leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
        Test-type catalog and notification preferences aren&apos;t configurable
        here yet — they&apos;re still hardcoded engine-side, not per-lab
        settings in the database.
      </div>
    </>
  );
}
