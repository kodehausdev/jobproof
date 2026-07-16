"use client";

// Full-screen gate rendered by (console)/layout.tsx while a tenant is
// 'payment_pending'. Collects a card via an embedded Stripe PaymentElement
// against a $0 SetupIntent (/api/onboarding/setup-intent) — no charge here;
// the real $297/mo subscription is created later by ops
// (scripts/activate-tenant.mjs) once provisioning is done.

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

// Themes the embedded PaymentElement (renders in a cross-origin iframe, so
// it can't see our Tailwind theme tokens — see globals.css) to match the
// terracotta/cream onboarding palette. Figtree is loaded via cssSrc since
// Stripe's iframe can't reach our next/font-hosted files.
const STRIPE_APPEARANCE = {
  theme: "flat" as const,
  variables: {
    colorPrimary: "#c96f4a",
    colorBackground: "#fffdfb",
    colorText: "#2b2420",
    colorTextSecondary: "#8a7869",
    colorTextPlaceholder: "#a8917d",
    colorDanger: "#b91c1c",
    fontFamily: "Figtree, system-ui, sans-serif",
    borderRadius: "999px",
  },
  rules: {
    ".Input": { border: "1.5px solid #ece0d2", boxShadow: "none", padding: "13px 18px" },
    ".Input:focus": { border: "1.5px solid #c96f4a", boxShadow: "none" },
    ".Label": { fontWeight: "600", fontSize: "12.5px", color: "#5c4f42" },
  },
};
const STRIPE_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" },
];

async function confirmCard(setupIntentId: string) {
  const res = await fetch("/api/onboarding/confirm-card", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ setup_intent_id: setupIntentId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not confirm card.");
}

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const { refreshTenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (confirmError) throw new Error(confirmError.message ?? "Card was declined.");
      if (!setupIntent) throw new Error("No confirmation returned.");
      await confirmCard(setupIntent.id);
      await refreshTenant();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement
        options={{
          defaultValues: { billingDetails: { address: { country: "US" } } },
          // Suppress Link's own "save my info" enrollment card — we collect
          // the contact details we need (email at signup, WhatsApp number in
          // the next onboarding step) ourselves; Stripe Link would otherwise
          // save them into Stripe's separate cross-merchant network instead.
          wallets: { link: "never" },
        }}
      />
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy || !stripe}
        className="rounded-full bg-terracotta py-[15px] font-onboarding text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark disabled:opacity-60"
      >
        {busy ? "Securing your card…" : "Secure my AI engine instance →"}
      </button>
    </form>
  );
}

function PaymentGateInner() {
  const searchParams = useSearchParams();
  const { refreshTenant } = useAuth();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stripe appends these to return_url after an off-page confirmation step
  // (e.g. 3-D Secure) — resolve that before showing the form again.
  const [resolvingRedirect, setResolvingRedirect] = useState(
    searchParams.get("redirect_status") === "succeeded"
  );

  useEffect(() => {
    const setupIntentId = searchParams.get("setup_intent");
    void (async () => {
      await Promise.resolve(); // defer past this render, even on the no-op path
      if (resolvingRedirect && setupIntentId) {
        try {
          await confirmCard(setupIntentId);
          await refreshTenant();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      }
      setResolvingRedirect(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resolvingRedirect) return;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/setup-intent", {
          method: "POST",
          headers: await authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not start checkout.");
        setClientSecret(data.clientSecret);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
  }, [resolvingRedirect]);

  return (
    <div className="grid min-h-screen place-items-center bg-cream-page p-5 font-onboarding">
      <div className="w-full max-w-md rounded-2xl border border-cream-border bg-cream p-7 shadow-[0_8px_30px_rgba(120,80,50,0.12)]">
        <h1 className="font-display text-[22px] font-medium text-ink">Secure your AI engine instance</h1>
        <p className="mt-2 text-[13.5px] text-cream-muted">
          We&apos;re about to dedicate a private AI engine instance and WhatsApp routing to your
          lab.
        </p>

        <div className="mt-4 rounded-xl border border-cream-border bg-cream-input p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-cream-muted">Today&apos;s total</span>
            <span className="text-2xl font-bold tracking-tight text-ink">$0.00</span>
          </div>
          <p className="mt-1.5 text-xs text-cream-muted">
            We require a card to dedicate an AI engine instance and routing. Subscription begins
            only when your line goes live — $297/mo, cancel anytime.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5">
          {resolvingRedirect ? (
            <div className="flex items-center gap-2.5 text-sm text-cream-muted">
              <span className="size-2 rounded-full bg-terracotta [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
              Confirming your card…
            </div>
          ) : !stripePromise ? (
            <div className="text-xs text-amber-700">
              Stripe isn&apos;t configured (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY missing).
            </div>
          ) : clientSecret ? (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret, locale: "en", appearance: STRIPE_APPEARANCE, fonts: STRIPE_FONTS }}
            >
              <CardForm />
            </Elements>
          ) : (
            <div className="flex items-center gap-2.5 text-sm text-cream-muted">
              <span className="size-2 rounded-full bg-terracotta [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
              Preparing secure checkout…
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[10.5px] font-medium tracking-[0.04em] text-cream-faint uppercase">
          Payment by Stripe · No charge today · Cancel anytime
        </p>
      </div>
    </div>
  );
}

export function PaymentGate() {
  return (
    <Suspense>
      <PaymentGateInner />
    </Suspense>
  );
}
