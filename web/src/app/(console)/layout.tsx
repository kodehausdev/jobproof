"use client";

import type { ReactNode } from "react";
import { AuthGate, useAuth } from "@/components/auth/auth-gate";
import { DashboardProvider } from "@/components/console/dashboard-provider";
import { ConsoleHeader } from "@/components/console/console-header";
import { PaymentGate } from "@/components/console/payment-gate";
import { ThemeProvider } from "@/components/console/theme-provider";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <OnboardingGate>{children}</OnboardingGate>
    </AuthGate>
  );
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  // Nothing to show until a card is on file — no nav, no dashboard.
  if (tenant?.onboarding_state === "payment_pending") return <PaymentGate />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <ThemeProvider>
        {(theme) => (
          <div
            className={`${theme === "dark" ? "dark" : ""} flex min-h-screen flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100`}
          >
            <ConsoleHeader />
            <main className="mx-auto w-full max-w-[1440px] flex-1 p-6">
              {children}
            </main>
            <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-6 py-3.5">
                <span className="font-mono text-[11.5px] text-slate-400">
                  Jobproof · console v0.1
                </span>
                <span className="ml-auto text-[11.5px] text-slate-400 dark:text-slate-500">
                  All transcripts sanitized at ingestion — raw audio is never
                  persisted.
                </span>
              </div>
            </footer>
          </div>
        )}
      </ThemeProvider>
    </DashboardProvider>
  );
}
