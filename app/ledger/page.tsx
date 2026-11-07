// Public transparency ledger: totals, live metrics, anonymized rows, donations, and the published policy.
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { marked } from "marked";
import { FundFlow } from "@/components/fund-flow";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { duration, money, moneyWhole, num, percent, plural, utc } from "@/lib/format";
import { buildLedger, type Ledger } from "@/lib/ledger/public";
import { LedgerGridClient } from "./ledger-grid-client";

export const metadata: Metadata = { title: "Public ledger · AidRelay" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  let ledger: Ledger | undefined;
  try {
    ledger = await buildLedger();
  } catch (err) {
    console.error("[ledger] could not load the fund", err);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium text-primary">Public ledger</p>
            <h1 className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">{ledger?.fund.name ?? "The relief fund"}</h1>
            <p className="max-w-[62ch] leading-relaxed text-muted-foreground">
              Every dollar in and out of the fund, each with its PayPal record id. No names, no addresses, no contact details. The policy the Case
              Officer follows is published below, unchanged.
            </p>
          </div>
          {ledger && (
            <p className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span>Updated {utc(ledger.generatedAt)}</span>
              <Link href="/api/ledger" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                JSON
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            </p>
          )}
        </header>

        {!ledger ? (
          <p role="status" className="rounded-xl bg-warning-soft p-4 text-sm text-warning">
            The ledger is temporarily unavailable because the fund’s records could not be loaded. Try again in a minute.
          </p>
        ) : (
          <>
            <section aria-label="Fund totals" className="rounded-2xl border border-border bg-card p-6 sm:p-8">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
                <Money label="Raised" cents={ledger.fund.raisedCents} sub={plural(ledger.donations.length, "donation", "donations")} hero />
                <Money label="Paid out" cents={ledger.fund.paidCents} sub={plural(ledger.metrics.casesPaid, "household", "households")} />
                <Money label="Reserved" cents={ledger.fund.reservedCents} sub="approved, being paid" />
                <Money label="Available" cents={ledger.fund.balanceCents} sub={`${num(ledger.metrics.casesWaiting)} waiting for funds`} />
              </dl>
              <FundFlow
                className="mt-8"
                raised={ledger.fund.raisedCents}
                paid={ledger.fund.paidCents}
                reserved={ledger.fund.reservedCents}
                available={ledger.fund.balanceCents}
              />
            </section>

            <section aria-labelledby="metrics" className="space-y-4">
              <h2 id="metrics" className="text-lg font-semibold tracking-tight">
                How the fund is doing
              </h2>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Median time to cash" value={duration(ledger.metrics.medianMinutesToCash)} sub="from application to money in PayPal" />
                <Metric label="Paid without a human" value={percent(ledger.metrics.autoPaidShare)} sub="inside the policy’s auto-approve limits" />
                <Metric label="Duplicate payouts" value={num(ledger.metrics.duplicatePayouts)} sub="one payout per household, enforced" />
                <Metric label="Payouts with a PayPal batch id" value={percent(ledger.metrics.paidWithBatchIdShare)} sub="every payment is a PayPal record" />
              </dl>
            </section>

            <section aria-labelledby="grants" className="space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="grants" className="text-lg font-semibold tracking-tight">
                  Grants
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  {plural(ledger.rows.length, "grant", "grants")} approved or paid · {num(ledger.metrics.casesInReview)} in review, not listed
                </p>
              </div>
              {ledger.rows.length === 0 ? (
                <Empty>No grants yet. A row appears here the moment a case is approved.</Empty>
              ) : (
                <LedgerGridClient rows={ledger.rows} />
              )}
            </section>

            <section aria-labelledby="donations" className="space-y-4">
              <h2 id="donations" className="text-lg font-semibold tracking-tight">
                Donations
              </h2>
              {ledger.donations.length === 0 ? (
                <Empty>
                  No donations yet.{" "}
                  <Link href="/donate" className="font-medium text-primary hover:underline">
                    Make the first one
                  </Link>
                </Empty>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-medium">
                          When
                        </th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">
                          Amount
                        </th>
                        <th scope="col" className="px-4 py-2.5 font-medium">
                          PayPal capture id
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ledger.donations.map((d) => (
                        <tr key={d.captureId}>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{utc(d.capturedAt)}</td>
                          <td className="px-4 py-2.5 text-right font-medium tabular-nums">{money(d.amountCents)}</td>
                          <td className="px-4 py-2.5 font-mono text-[13px]" translate="no">
                            {d.captureId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section id="policy" aria-labelledby="policy-title" className="scroll-mt-20 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="policy-title" className="text-lg font-semibold tracking-tight">
                  The policy the agent follows
                </h2>
                <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs text-accent-foreground">{ledger.fund.policyVersion}</span>
              </div>
              <p className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
                Written by the fund’s volunteers. The Case Officer cites these clause ids in every decision, and the limits in §5 are enforced in code.
              </p>
              <article
                className="policy rounded-2xl border border-border bg-card p-6 text-sm sm:p-8"
                dangerouslySetInnerHTML={{ __html: marked.parse(ledger.policyMarkdown) as string }}
              />
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function Money({ label, cents, sub, hero }: { label: string; cents: number; sub?: string; hero?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-semibold tracking-[-0.025em] tabular-nums ${hero ? "text-4xl" : "text-3xl"}`}>{moneyWhole(cents)}</dd>
      {sub && <dd className="mt-1 text-[13px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-muted/70 p-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="mt-1 text-[13px] leading-snug text-muted-foreground">{sub}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
