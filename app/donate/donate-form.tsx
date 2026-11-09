"use client";

// PayPal JS SDK (v5 Buttons) donate flow: createOrder → server creates the Orders v2 order,
// onApprove → server captures it and records the donation.
import { ArrowRight, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fieldClass } from "@/components/ui/input";
import { money, moneyWhole } from "@/lib/format";

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
const PRESETS_CENTS = [2000, 5000, 10000, 25000];
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

/** The policy's grant per level of need (policy.md §3), passed in from the server. */
export type TierCents = Record<1 | 2 | 3 | 4, number>;

const FRACTIONS: Array<[number, string]> = [
  [0.75, "Three quarters"],
  [0.5, "Half"],
  [0.25, "A quarter"],
  [0.2, "A fifth"],
];

/** What the amount means for a family, in the policy's own grants. */
function impact(cents: number, tier: TierCents): string {
  if (cents < tier[1]) {
    const part = FRACTIONS.find(([r]) => Math.abs(cents / tier[1] - r) < 0.001)?.[1] ?? "Part";
    return `${part} of the ${moneyWhole(tier[1])} grant a family gets for spoiled food and small losses`;
  }
  if (cents < tier[2]) return `A full ${moneyWhole(tier[1])} grant for spoiled food and small losses`;
  if (cents < tier[3]) return "A full grant for a family whose home was damaged";
  if (cents < tier[4]) return "A full grant for a family forced out of its home";
  if (cents < tier[4] * 2) return "A full grant for a displaced family with children or a medical need";
  return `Full grants for ${Math.floor(cents / tier[2])} families whose homes were damaged`;
}

export function DonateForm({ clientId, tierCents }: { clientId: string; tierCents: TierCents }) {
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
            // PayPal can answer a capture with DECLINED or FAILED: nothing reached the fund.
            if (data.status === "DECLINED" || data.status === "FAILED") {
              setPhase({ kind: "error", message: "PayPal did not complete this payment, so you were not charged." });
              return;
            }
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
    // Anything but COMPLETED (a payment PayPal is still reviewing) is recorded but not yet counted in the fund.
    const settled = phase.status === "COMPLETED";
    return (
      <section aria-labelledby="thanks" className="animate-relay-in h-fit space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={`flex size-10 shrink-0 items-center justify-center rounded-full ${settled ? "bg-success-soft text-success" : "bg-wait-soft text-wait"}`}>
            {settled ? <CircleCheck className="size-5" /> : <LoaderCircle className="size-5" />}
          </span>
          <div>
            <h2 id="thanks" className="text-xl font-semibold tracking-tight">
              {settled ? `Thank you. Your ${moneyWhole(phase.amountCents)} is in the fund.` : `Thank you. PayPal is still confirming your ${moneyWhole(phase.amountCents)}.`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {settled
                ? "The AI case officer is already checking whether an approved family is waiting for it."
                : "It joins the fund and appears on the public ledger as soon as PayPal completes it. There is nothing more for you to do."}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-border pt-5 text-sm">
          <dt className="text-muted-foreground">PayPal receipt</dt>
          <dd className="truncate font-mono" translate="no">
            {phase.captureId}
          </dd>
          {settled && (
            <>
              <dt className="text-muted-foreground">Raised so far</dt>
              <dd className="font-medium tabular-nums">{moneyWhole(phase.raisedCents)}</dd>
            </>
          )}
        </dl>
        <Link href="/ledger" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
          Follow it on the public ledger
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>
    );
  }

  return (
    <section aria-labelledby="give" className="h-fit space-y-6 rounded-2xl border border-border bg-card p-6">
      <h2 id="give" className="text-lg font-semibold tracking-tight">
        How much would you like to give?
      </h2>
      <div role="group" aria-label="Preset amounts" className="grid grid-cols-4 gap-2">
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
      <div className="border-t border-border pt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Your gift</span>
          <span aria-live="polite" className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">
            {money(amountCents)}
          </span>
        </div>
        <p className="mt-1.5 text-right text-[13px] text-muted-foreground">{impact(amountCents, tierCents)}</p>
      </div>

      {/* PayPal's iframe paints white; in dark mode that white becomes a deliberate tray instead of a hole. */}
      <div ref={containerRef} className="min-h-[104px] dark:rounded-xl dark:bg-white dark:p-3" />

      {phase.kind === "loading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Loading PayPal…
        </p>
      )}
      {phase.kind === "capturing" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          Confirming your payment with PayPal…
        </p>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {phase.message} Please try again or choose a different amount.
        </p>
      )}
    </section>
  );
}
