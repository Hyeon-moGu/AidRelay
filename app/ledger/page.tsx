// Public transparency ledger: totals, live metrics, anonymized rows, donations, and the published policy.
import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";
import { buildLedger, type Ledger } from "@/lib/ledger/public";
import { formatMoney } from "@/lib/money";
import { LedgerGridClient } from "./ledger-grid-client";

export const metadata: Metadata = { title: "Public ledger · AidRelay" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  let ledger: Ledger | undefined;
  let error: string | undefined;
  try {
    ledger = await buildLedger();
  } catch (err) {
    console.error("[ledger] could not load the fund", err);
    error = "the fund's records could not be loaded (see the server log)";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-3xl font-semibold">Public ledger{ledger ? ` · ${ledger.fund.name}` : ""}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every dollar in and out of the fund, with its PayPal record id. No names, no addresses, no contact details. The policy the
          Case Officer follows is published below, unchanged.
        </p>
      </header>

      {error || !ledger ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          The ledger is temporarily unavailable: {error}
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Stat label="Raised" value={formatMoney(ledger.fund.raisedCents, ledger.fund.currency)} />
            <Stat label="Paid out" value={formatMoney(ledger.fund.paidCents, ledger.fund.currency)} sub={`${ledger.metrics.casesPaid} household(s)`} />
            <Stat label="Reserved" value={formatMoney(ledger.fund.reservedCents, ledger.fund.currency)} sub={`${ledger.metrics.casesWaiting} waiting for funds`} />
            <Stat label="Available" value={formatMoney(ledger.fund.balanceCents, ledger.fund.currency)} sub={`${ledger.metrics.casesInReview} in review`} />
          </section>

          <section className="grid gap-3 sm:grid-cols-4">
            <Stat label="Median time to cash" value={ledger.metrics.medianMinutesToCash == null ? "–" : `${ledger.metrics.medianMinutesToCash} min`} sub="application → money in PayPal" />
            <Stat label="Paid without a human" value={ledger.metrics.autoPaidShare == null ? "–" : `${Math.round(ledger.metrics.autoPaidShare * 100)}%`} sub="inside the policy's auto-approve limits" />
            <Stat label="Duplicate payouts" value={String(ledger.metrics.duplicatePayouts)} sub="one payout per household, enforced" />
            <Stat label="Payouts with a PayPal batch id" value={ledger.metrics.paidWithBatchIdShare == null ? "–" : `${Math.round(ledger.metrics.paidWithBatchIdShare * 100)}%`} sub="every payment is a PayPal record" />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Grants</h2>
            {ledger.rows.length === 0 ? (
              <p className="text-sm text-zinc-500">No grants yet. Rows appear here the moment a case is approved.</p>
            ) : (
              <LedgerGridClient rows={ledger.rows} />
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Donations</h2>
            {ledger.donations.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No donations yet.{" "}
                <Link href="/donate" className="underline">
                  Make the first one
                </Link>
                .
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr>
                    <th className="py-1 font-medium">When</th>
                    <th className="py-1 font-medium">Amount</th>
                    <th className="py-1 font-medium">PayPal capture</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.donations.map((d) => (
                    <tr key={d.captureId} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-1">{new Date(d.capturedAt).toLocaleString()}</td>
                      <td className="py-1">{formatMoney(d.amountCents, d.currency)}</td>
                      <td className="py-1 font-mono">{d.captureId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section id="policy" className="space-y-3">
            <h2 className="text-lg font-semibold">The policy the agent follows (version {ledger.fund.policyVersion})</h2>
            <p className="text-sm text-zinc-500">Written by the fund&apos;s volunteers. The Case Officer cites these clause ids in every decision; the limits in §5 are enforced in code.</p>
            <article className="policy rounded-md border border-zinc-200 p-5 text-sm dark:border-zinc-800" dangerouslySetInnerHTML={{ __html: marked.parse(ledger.policyMarkdown) as string }} />
          </section>

          <p className="text-xs text-zinc-500">
            Generated {new Date(ledger.generatedAt).toLocaleString()} from the fund&apos;s records. Machine-readable copy:{" "}
            <Link href="/api/ledger" className="underline">
              /api/ledger
            </Link>
            . Sandbox only.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
