"use client";

import Link from "next/link";
import { KpiCard } from "@/components/console/kpi-card";
import { LiveFeed } from "@/components/console/live-feed";
import { useDashboard } from "@/components/console/dashboard-provider";
import { useAuth } from "@/components/auth/auth-gate";
import { NumberIntake } from "@/components/console/number-intake";
import { ProvisioningTracker } from "@/components/console/provisioning-tracker";
import { formatLongDate } from "@/lib/format-time";

const AVG_MINUTES_SAVED_PER_CALL = 4.2;

function Icon({ path }: { path: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  phone: "M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z",
  calendar: "M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M8.5 13.5l2 2 4-4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2",
  shield: "M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z",
};

const CONFIGURING_BADGE = (
  <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
    Configuring Engine
  </span>
);

export default function OverviewPage() {
  const { status, tenant, counters } = useDashboard();
  const { tenant: authTenant } = useAuth();
  const onboardingState = authTenant?.onboarding_state;
  const awaitingNumber = onboardingState === "provisioning_pending_number";
  const provisioningActive = onboardingState === "provisioning_active";

  const hoursSaved = (counters.calls_answered * AVG_MINUTES_SAVED_PER_CALL) / 60;
  // The business's own "today", not the viewer's — matters near midnight for
  // anyone checking the console from a different timezone than the business.
  const today = formatLongDate(new Date(), tenant?.timezone);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight">
            Front-Desk Operations
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">
            {today}
            {tenant
              ? ` · ${tenant.lab_name} · ${tenant.slot_capacity} jobs per slot`
              : " · connecting to engine…"}
          </p>
        </div>
        <Link
          href="/billing"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Plan: Pro — $297/mo
        </Link>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
        <KpiCard
          label="Total Calls Answered"
          value={provisioningActive ? "—" : counters.calls_answered}
          accent="indigo"
          icon={<Icon path={ICONS.phone} />}
          sub={
            provisioningActive
              ? CONFIGURING_BADGE
              : status === "offline"
                ? "—"
                : <>Every inbound conversation, voice + WhatsApp</>
          }
        />
        <KpiCard
          label="Appointments Booked"
          value={provisioningActive ? "—" : counters.bookings_confirmed}
          accent="violet"
          icon={<Icon path={ICONS.calendar} />}
          sub={provisioningActive ? CONFIGURING_BADGE : "Confirmed by the AI against live capacity"}
        />
        <KpiCard
          label="Front-Desk Hours Saved"
          value={
            provisioningActive ? (
              "—"
            ) : (
              <>
                {hoursSaved.toFixed(1)}{" "}
                <span className="text-base font-semibold text-slate-500 dark:text-slate-400">
                  hrs
                </span>
              </>
            )
          }
          accent="amber"
          icon={<Icon path={ICONS.clock} />}
          sub={
            provisioningActive
              ? CONFIGURING_BADGE
              : `≈ ${AVG_MINUTES_SAVED_PER_CALL} min staff time per call handled`
          }
        />
        <div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white px-4.5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(4,120,87,0.35)] dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-slate-900 dark:shadow-none">
          <span className="absolute inset-x-0 top-0 h-[3px] bg-emerald-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
              Data Retention &amp; Privacy
            </span>
            <span className="grid size-7 flex-none place-items-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Icon path={ICONS.shield} />
            </span>
          </div>
          <div className="mt-2.5 text-[26px] font-bold leading-none tracking-tight text-emerald-950 dark:text-emerald-100">
            {counters.guardrail_events === 0
              ? "100% Verified"
              : `${counters.guardrail_events} privacy intercept${
                  counters.guardrail_events === 1 ? "" : "s"
                }`}
          </div>
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <span className="size-1.5 rounded-full bg-emerald-600" />
            <span className="font-mono text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
              PRIVACY GUARDRAILS ACTIVE
            </span>
          </div>
        </div>
      </div>

      {awaitingNumber ? (
        <NumberIntake />
      ) : provisioningActive ? (
        <ProvisioningTracker />
      ) : (
        <LiveFeed limit={6} />
      )}
    </div>
  );
}
