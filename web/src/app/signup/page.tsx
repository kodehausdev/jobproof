"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

const STEPS = ["Business profile", "Owner account", "Review & create account"];

function WrenchLogo() {
  return (
    <div className="grid size-11 flex-none place-items-center rounded-[14px] bg-[#e8785030]">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-terracotta)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    </div>
  );
}

const inputCls =
  "w-full appearance-none rounded-full border border-cream-border bg-cream-input px-[18px] py-[13px] text-sm text-ink outline-none focus:border-terracotta";

const labelCls = "flex flex-col gap-1.5 font-onboarding text-[12.5px] font-semibold text-cream-label";

function SignupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [labName, setLabName] = useState("");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [openHour, setOpenHour] = useState(8);
  const [closeHour, setCloseHour] = useState(17);
  const [slotCapacity, setSlotCapacity] = useState(4);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function next(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1 && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStep((s) => s + 1);
  }

  async function finishSignup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labName, timezone, openHour, closeHour, slotCapacity, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setBusy(false);
        return;
      }
      if (supabase) await supabase.auth.signInWithPassword({ email, password });
      router.push("/overview");
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream-page py-10 font-onboarding">
      <div className="mx-auto w-full max-w-[600px] px-5">
        <div className="mb-5 flex items-center gap-3">
          <WrenchLogo />
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-ink">Jobproof</div>
            <div className="text-[10px] font-semibold tracking-[0.08em] text-cream-faint uppercase">NEW BUSINESS SETUP</div>
          </div>
          <Link href="/login" className="ml-auto text-[13px] font-semibold text-terracotta hover:text-terracotta-dark">
            Already set up? Sign in
          </Link>
        </div>

        {/* Stepper */}
        <div className="mb-5 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span
                className={
                  i < step
                    ? "grid size-6.5 flex-none place-items-center rounded-full bg-terracotta text-[13px] font-semibold text-white"
                    : i === step
                      ? "grid size-6.5 flex-none place-items-center rounded-full bg-terracotta text-[12px] font-semibold text-white"
                      : "grid size-6.5 flex-none place-items-center rounded-full border border-cream-border bg-white text-[12px] font-semibold text-cream-faint"
                }
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className={`text-[13px] font-semibold whitespace-nowrap ${i <= step ? "text-ink" : "text-cream-faint"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <span className={`h-0.5 flex-1 rounded ${i < step ? "bg-terracotta" : "bg-cream-border"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-cream-border bg-cream px-6 pt-7 pb-6 shadow-[0_8px_30px_rgba(120,80,50,0.12)] sm:px-10 sm:pt-9 sm:pb-7">
          {error ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              {error}
            </div>
          ) : null}

          {step === 0 && (
            <form onSubmit={next} className="flex flex-col gap-3.5">
              <h1 className="font-display text-[22px] font-medium text-ink">Tell us about your business</h1>
              <p className="-mt-2 text-[13.5px] text-cream-muted">
                A few details so we can get your dispatch line set up just right.
              </p>
              <label className={labelCls}>
                Business name
                <input required minLength={2} value={labName} onChange={(e) => setLabName(e.target.value)} placeholder="Ironclad Home Services — Denver" className={inputCls} />
              </label>
              <label className={labelCls}>
                Timezone
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-3.5">
                <label className={labelCls}>
                  Opens
                  <select value={openHour} onChange={(e) => setOpenHour(Number(e.target.value))} className={inputCls}>
                    {Array.from({ length: 12 }, (_, h) => h + 5).map((h) => (
                      <option key={h} value={h}>{h}:00</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  Closes
                  <select value={closeHour} onChange={(e) => setCloseHour(Number(e.target.value))} className={inputCls}>
                    {Array.from({ length: 12 }, (_, h) => h + 12).map((h) => (
                      <option key={h} value={h}>{h}:00</option>
                    ))}
                  </select>
                </label>
                <label className={labelCls}>
                  Jobs per slot
                  <select value={slotCapacity} onChange={(e) => setSlotCapacity(Number(e.target.value))} className={inputCls}>
                    {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="mt-1 rounded-full bg-terracotta py-[15px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark">
                Continue
              </button>
            </form>
          )}

          {step === 1 && (
            <form onSubmit={next} className="flex flex-col gap-3.5">
              <h1 className="font-display text-[22px] font-medium text-ink">Owner account</h1>
              <p className="-mt-2 text-[13.5px] text-cream-muted">You&apos;ll use this to sign in to the console. Staff accounts come later.</p>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourbusiness.com" className={inputCls} />
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 characters)" className={inputCls} />
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className={inputCls} />
              <div className="mt-1 flex gap-3">
                <button type="button" onClick={() => setStep(0)} className="flex-none rounded-full border border-cream-border bg-white px-6 py-[15px] text-sm font-semibold text-cream-label hover:bg-cream-page">
                  Back
                </button>
                <button type="submit" className="flex-1 rounded-full bg-terracotta py-[15px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark">
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h1 className="font-display text-[22px] font-medium text-ink">Review &amp; create account</h1>
              <div className="rounded-2xl border border-cream-border bg-cream-input p-5.5 text-sm">
                <div className="flex justify-between py-2"><span className="text-cream-muted">Business</span><span className="font-semibold text-ink">{labName}</span></div>
                <div className="flex justify-between py-2"><span className="text-cream-muted">Hours</span><span className="font-semibold text-ink">{openHour}:00 – {closeHour}:00 · {timezone.split("/")[1]?.replace("_", " ")}</span></div>
                <div className="flex justify-between py-2"><span className="text-cream-muted">Jobs per slot</span><span className="font-semibold text-ink">{slotCapacity}</span></div>
                <div className="flex justify-between py-2"><span className="text-cream-muted">Owner</span><span className="font-semibold text-ink">{email}</span></div>
                <div className="mt-1 flex justify-between border-t border-cream-border pt-3">
                  <span className="text-cream-muted">Plan</span>
                  <span className="text-lg font-bold text-terracotta">$297<span className="text-[13px] font-medium text-cream-muted">/mo per location</span></span>
                </div>
              </div>
              <button onClick={finishSignup} disabled={busy} className="rounded-full bg-terracotta py-[15px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark disabled:opacity-60">
                {busy ? "Creating your console…" : "Create my console →"}
              </button>
              <button onClick={() => setStep(1)} className="text-center text-[13px] font-medium text-terracotta hover:text-terracotta-dark">
                ← Back
              </button>
              <p className="text-center text-[10.5px] font-medium tracking-[0.04em] text-cream-faint uppercase">
                NO CHARGE TODAY · SECURE YOUR CARD NEXT · NO CUSTOMER DATA REQUIRED TO START
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupWizard />
    </Suspense>
  );
}
