"use client";

// PayPal JS SDK (v5 Buttons) donate flow: createOrder → server creates the Orders v2 order,
// onApprove → server captures it and records the donation. See docs/CONCEPT.md §7 "Donor".
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

type PayPalButtonsFactory = (options: {
  style?: { layout?: "vertical" | "horizontal"; shape?: "rect" | "pill"; label?: string };
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
  const [phase, setPhase] = useState<Phase>(clientId ? { kind: "loading" } : { kind: "unconfigured" });
  const amountRef = useRef(amountCents);
  amountRef.current = amountCents;
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
        style: { layout: "vertical", shape: "rect", label: "donate" },
        createOrder: async () => {
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
    if (!/^\d+(\.\d{0,2})?$/.test(value)) return;
    const cents = Math.round(Number(value) * 100);
    if (cents >= MIN_CENTS && cents <= MAX_CENTS) setAmountCents(cents);
  };

  if (phase.kind === "unconfigured") {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        The donate button needs <code>PAYPAL_CLIENT_ID</code> in <code>.env</code> (AGENTS.md §7).
      </p>
    );
  }

  if (phase.kind === "done") {
    return (
      <section className="space-y-3 rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950">
        <h2 className="text-lg font-semibold">Thank you — {formatMoney(phase.amountCents)} received</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">PayPal capture</dt>
          <dd className="font-mono">{phase.captureId}</dd>
          <dt className="text-zinc-500">Order</dt>
          <dd className="font-mono">{phase.orderId}</dd>
          <dt className="text-zinc-500">Status</dt>
          <dd>{phase.status}</dd>
          <dt className="text-zinc-500">Fund raised so far</dt>
          <dd>{formatMoney(phase.raisedCents)}</dd>
        </dl>
        <p className="text-sm">
          <Link href="/ledger" className="underline">
            See it on the public ledger
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Amount</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS_CENTS.map((cents) => (
            <Button
              key={cents}
              type="button"
              variant={amountCents === cents && !customDollars ? "default" : "outline"}
              onClick={() => {
                setCustomDollars("");
                setAmountCents(cents);
              }}
            >
              {formatMoney(cents)}
            </Button>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">or $</span>
            <input
              inputMode="decimal"
              placeholder="custom"
              value={customDollars}
              onChange={(e) => onCustomChange(e.target.value)}
              className="w-24 rounded-md border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            />
          </label>
        </div>
        <p className="text-sm text-zinc-500">
          You are donating <strong>{formatMoney(amountCents)}</strong>.
        </p>
      </fieldset>

      <div ref={containerRef} className="min-h-12" />

      {phase.kind === "loading" && <p className="text-sm text-zinc-500">Loading PayPal…</p>}
      {phase.kind === "capturing" && (
        <p className="text-sm text-zinc-500">Capturing payment for order {phase.orderId}…</p>
      )}
      {phase.kind === "error" && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          {phase.message}
        </p>
      )}
    </section>
  );
}
