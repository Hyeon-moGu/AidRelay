"use client";

// PayPal JS SDK (v5 Buttons) donate flow: createOrder → server creates the Orders v2 order,
// onApprove → server captures it and records the donation.
import { ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fieldClass } from "@/components/ui/input";
import { money } from "@/lib/format";

type PayPalButtonsFactory = (options: {
  style?: { layout?: "vertical" | "horizontal"; shape?: "rect" | "pill"; label?: string; height?: number };
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
}) => { render: (container: HTMLElement) => Promise<void>; close: () => Promise<void> };

declare global {
  interface Window {
    paypal?: { Buttons: PayPalButtonsFactory };
  }
}

const SCRIPT_ID = "paypal-js-sdk";
const PRESETS_CENTS = [2000, 5000, 10000];
const MIN_CENTS = 100;
const MAX_CENTS = 1_000_000;

type Phase =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "capturing"; orderId: string }
  | { kind: "done"; orderId: string; captureId: string; amountCents: number; raisedCents: number; status: string }
  | { kind: "error"; message: string };

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ApiResult<T>;
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

function loadSdk(clientId: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("The PayPal SDK could not be loaded.")), {
      once: true,
    });
    if (!existing) {
      const params = new URLSearchParams({
        "client-id": clientId,
        currency: "USD",
        intent: "capture",
        components: "buttons",
        locale: "en_US",
      });
      script.id = SCRIPT_ID;
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

export function DonateForm({ clientId }: { clientId: string }) {
  const [amountCents, setAmountCents] = useState(PRESETS_CENTS[0]);
  const [customDollars, setCustomDollars] = useState("");
  const [customError, setCustomError] = useState(false);
  const [phase, setPhase] = useState<Phase>(clientId ? { kind: "loading" } : { kind: "unconfigured" });
  const amountRef = useRef(amountCents);
  amountRef.current = amountCents;
  const blockedRef = useRef(false);
  blockedRef.current = customError;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let buttons: ReturnType<PayPalButtonsFactory> | undefined;

    const mount = async () => {
      await loadSdk(clientId);
      const container = containerRef.current;
      if (cancelled || !window.paypal || !container) return;
      container.innerHTML = "";
      buttons = window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "donate", height: 48 },
        createOrder: async () => {
          if (blockedRef.current) throw new Error("Enter an amount between $1 and $10,000.");
          const data = await postJson<{ orderId: string }>("/api/donate/create-order", {
            amountCents: amountRef.current,
          });
          return data.orderId;
        },
        onApprove: async ({ orderID }) => {
          setPhase({ kind: "capturing", orderId: orderID });
          try {
            const data = await postJson<Omit<Extract<Phase, { kind: "done" }>, "kind">>(
              "/api/donate/capture-order",
              { orderId: orderID },
            );
            setPhase({ kind: "done", ...data });
          } catch (err) {
            setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
          }
        },
        onCancel: () => setPhase({ kind: "ready" }),
        onError: (err) =>
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
      });
      await buttons.render(container);
      if (!cancelled) setPhase({ kind: "ready" });
    };

    mount().catch((err) =>
      setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
      void buttons?.close();
    };
  }, [clientId]);

  const onCustomChange = (value: string) => {
    setCustomDollars(value);
    if (value === "") {
      setCustomError(false);
      return;
    }
    const valid = /^\d+(\.\d{0,2})?$/.test(value);
    const cents = valid ? Math.round(Number(value) * 100) : NaN;
    const inRange = cents >= MIN_CENTS && cents <= MAX_CENTS;
    setCustomError(!inRange);
    if (inRange) setAmountCents(cents);
  };

  if (phase.kind === "unconfigured") {
    return (
      <p role="status" className="h-fit rounded-2xl bg-warning-soft p-5 text-sm text-warning">
        The donate button needs <code className="font-mono">PAYPAL_CLIENT_ID</code> in <code className="font-mono">.env</code>.
      </p>
    );
  }

  if (phase.kind === "done") {
    return (
      <section aria-labelledby="thanks" className="animate-relay-in h-fit space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="size-5" />
          </span>
          <div>
            <h2 id="thanks" className="text-xl font-semibold tracking-tight">
              Thank you. {money(phase.amountCents)} received.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">The Case Officer is already checking who it can pay.</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-border pt-5 text-sm">
          <dt className="text-muted-foreground">PayPal capture</dt>
          <dd className="truncate font-mono" translate="no">
            {phase.captureId}
          </dd>
          <dt className="text-muted-foreground">Order</dt>
          <dd className="truncate font-mono" translate="no">
            {phase.orderId}
          </dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{phase.status.toLowerCase()}</dd>
          <dt className="text-muted-foreground">Fund raised so far</dt>
          <dd className="font-medium tabular-nums">{money(phase.raisedCents)}</dd>
        </dl>
        <Link href="/ledger" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          See it on the public ledger
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="give" className="h-fit space-y-6 rounded-2xl border border-border bg-card p-6">
      <h2 id="give" className="text-lg font-semibold tracking-tight">
        Choose an amount
      </h2>
      <div role="group" aria-label="Preset amounts" className="grid grid-cols-3 gap-2">
        {PRESETS_CENTS.map((cents) => {
          const selected = amountCents === cents && !customDollars;
          return (
            <button
              key={cents}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setCustomDollars("");
                setCustomError(false);
                setAmountCents(cents);
              }}
              className={`h-12 rounded-lg border text-[15px] font-semibold tabular-nums transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] ${
                selected ? "border-primary bg-accent text-accent-foreground" : "border-input/60 bg-card hover:bg-muted"
              }`}
            >
              {money(cents).replace(".00", "")}
            </button>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <label htmlFor="custom-amount" className="text-sm font-medium">
          Other amount
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
            $
          </span>
          <input
            id="custom-amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="35"
            value={customDollars}
            aria-invalid={customError ? true : undefined}
            aria-describedby={customError ? "custom-amount-error" : undefined}
            onChange={(e) => onCustomChange(e.target.value)}
            className={`${fieldClass} h-11 pl-7 tabular-nums`}
          />
        </div>
        {customError && (
          <p id="custom-amount-error" className="text-[13px] font-medium text-danger">
            Enter an amount between $1 and $10,000.
          </p>
        )}
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-5">
        <span className="text-sm text-muted-foreground">You are donating</span>
        <span aria-live="polite" className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">
          {money(amountCents)}
        </span>
      </div>

      <div ref={containerRef} className="min-h-[104px]" />

      {phase.kind === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Loading PayPal…
        </p>
      )}
      {phase.kind === "capturing" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Capturing the payment…
        </p>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {phase.message} Try again, or pick another amount.
        </p>
      )}
    </section>
  );
}
