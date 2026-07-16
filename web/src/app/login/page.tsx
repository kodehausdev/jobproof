"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function FlaskLogo() {
  return (
    <div className="grid size-11 flex-none place-items-center rounded-[14px] bg-[#e8785030]">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-terracotta)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M9 3v7l-4.5 8a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 10V3" />
        <path d="M7.5 3h9" />
        <path d="M8 14h8" />
      </svg>
    </div>
  );
}

const inputCls =
  "w-full appearance-none rounded-full border border-cream-border bg-cream-input px-[18px] py-[13px] text-sm text-ink outline-none focus:border-terracotta";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in → straight to the console.
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/overview");
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/overview");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cream-page p-5 font-onboarding">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <FlaskLogo />
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-ink">
              MedLab AI
            </div>
            <div className="text-[10px] font-semibold tracking-[0.08em] text-cream-faint uppercase">
              AI Receptionist · Console
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-cream-border bg-cream px-6 pt-7 pb-6 shadow-[0_8px_30px_rgba(120,80,50,0.12)] sm:px-9 sm:pt-9 sm:pb-7">
          <h1 className="font-display text-[22px] font-medium text-ink">Sign in</h1>
          <p className="mt-1.5 text-[13.5px] text-cream-muted">
            Console access is provisioned per lab. Contact your administrator
            if you need an account.
          </p>

          {!supabase ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
              Supabase isn&apos;t configured (<span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span>).
              Local dev without keys skips sign-in entirely.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3.5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourlab.com"
                className={inputCls}
              />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputCls}
              />
              {error ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-terracotta py-[15px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-[13px] text-cream-muted">
          Setting up a new lab?{" "}
          <a href="/signup" className="font-semibold text-terracotta hover:text-terracotta-dark">
            Start your subscription →
          </a>
        </p>
        <p className="mt-3 text-center text-[10.5px] font-medium tracking-[0.04em] text-cream-faint uppercase">
          Tenant-scoped access · Enforced by row-level security
        </p>
      </div>
    </div>
  );
}
