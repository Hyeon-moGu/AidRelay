// Public transparency ledger: what the fund raised and paid, how fast and how safely, and an AG Studio report
// (grants by need, who approved, every grant and donation). The plain tables are the fallback if AG Studio
// cannot load. The rules the agent follows live on /policy.
import { ArrowRight, ArrowUpRight, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FundFlow } from "@/components/fund-flow";
import { cn } from "cn";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { duration, money, moneyWhole, num, percent, plural, utc } from "@/lib/format";
import { buildLedger, type Ledger } from "@/lib/ledger/public";
import { getEnv } from "@/lib/env";
import { LedgerGridClient } from "./ledger-grid-client";
import { LedgerStudioClient } from "./ledger-studio-client";

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
      <main id="main" className="flex-1">
        <section className="hero-glow border-b border-border/70">
          <div className="mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
            <p className="text-sm font-medium text-primary">Public ledger{ledger ? ` · ${ledger.fund.name}` : ""}</p>
            <h1 className="mt-3 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">Every dollar, accounted for.</h1>
            {ledger && <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">{lead(ledger)}</p>}
            {ledger && (
              <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                <span>Updated {utc(ledger.generatedAt)}</span>
                <Link href="/api/ledger" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  Download the data as JSON
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </p>
            )}
          </div>
        </section>

        <div className="mx-auto w-full max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-14">
          {!ledger ? (
            <p role="status" className="rounded-xl bg-warning-soft p-4 text-sm text-warning">
              The ledger can’t load the fund’s records right now. Please try again in a minute.
            </p>
          ) : (
            <>
              <section aria-labelledby="report" className="space-y-5">
                <div className="space-y-2">
                  <h2 id="report" className="text-xl font-semibold tracking-tight">
                    The live report
                  </h2>
                  <p className="max-w-[72ch] text-[15px] leading-relaxed text-muted-foreground">
                    {reportIntro(ledger)}
                  </p>
                </div>
                <LedgerStudioClient
                  ledger={{ rows: ledger.rows, donations: ledger.donations, fund: ledger.fund }}
                  licenseKey={getEnv().AG_STUDIO_LICENSE_KEY ?? ""}
                  fallback={<PlainLedger ledger={ledger} />}
                />
              </section>

              <section aria-labelledby="safeguards" className="space-y-5">
                <h2 id="safeguards" className="text-xl font-semibold tracking-tight">
                  Fast, and still careful
                </h2>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Typical time to cash" value={duration(ledger.metrics.medianMinutesToCash)} sub="from applying to money in the family’s PayPal account" />
                  <Metric label="Paid without waiting for a volunteer" value={percent(ledger.metrics.autoPaidShare)} sub="small, clear cases inside the fund’s limits" />
                  <Metric label="Households paid twice" value={num(ledger.metrics.duplicatePayouts)} sub="PayPal itself refuses a second payout for the same case" />
                  <Metric label="Backed by a PayPal record" value={percent(ledger.metrics.paidWithBatchIdShare)} sub="every payment carries its PayPal payout id" />
                </dl>
              </section>

              <section aria-labelledby="rules" className="flex flex-col gap-5 rounded-2xl bg-accent/60 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
                <div className="flex gap-4">
                  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary">
                    <Scale className="size-5" />
                  </span>
                  <div className="space-y-1.5">
                    <h2 id="rules" className="text-lg font-semibold tracking-tight">
                      Who decides who gets paid?
                    </h2>
                    <p className="max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
                      The fund’s volunteers wrote the rules before the first application arrived. The AI case officer follows them on every case, pays
                      only small and clear ones on its own and leaves every refusal to a person.
                    </p>
                  </div>
                </div>
                <Link
                  href="/policy"
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-card px-4 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.97] sm:self-center"
                >
                  Read the rules
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </section>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function lead(ledger: Ledger): string {
  const { raisedCents, paidCents } = ledger.fund;
  if (raisedCents === 0) return "No donations have arrived yet. The first one will show up here within seconds, along with every grant it pays for.";
  const households = plural(ledger.metrics.casesPaid, "household", "households");
  const paid = paidCents > 0 ? `, and ${moneyWhole(paidCents)} of it is already in the PayPal accounts of ${households}` : "";
  return `Donors have given ${moneyWhole(raisedCents)} so far${paid}. Each payment below carries its PayPal record, and nothing on this page can identify the families who received it.`;
}

function waitingLine(ledger: Ledger): string {
  const n = ledger.metrics.casesWaiting;
  if (n === 0) return "for the next approved family";
  return `${plural(n, "approved family", "approved families")} waiting for more`;
}

function reportIntro(ledger: Ledger): string {
  const review = ledger.metrics.casesInReview;
  const pending =
    review === 0 ? "" : review === 1 ? " 1 more application is still being reviewed and will appear here if it is approved." : ` ${num(review)} more applications are still being reviewed and will appear here if they are approved.`;
  return `Select a bar, a slice or a payout to show only those grants, and select it again to show them all.${pending}`;
}

/** Where the money is, drawn without AG Studio: the fallback's version of the fund-progress widget. */
function FundTotals({ ledger }: { ledger: Ledger }) {
  return (
    <section aria-label="Fund totals" className="rounded-2xl border border-border bg-card p-6 sm:p-8">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-7 lg:grid-cols-4">
        <Money label="Raised" cents={ledger.fund.raisedCents} sub={`from ${plural(ledger.donations.length, "donation", "donations")}`} hero />
        <Money label="Paid to families" dot="bg-bar-paid" cents={ledger.fund.paidCents} sub={plural(ledger.metrics.casesPaid, "household", "households")} hero />
        <Money label="On its way" dot="bg-bar-reserved" cents={ledger.fund.reservedCents} sub={ledger.fund.reservedCents > 0 ? "approved, PayPal is sending it" : "nothing in transit right now"} />
        <Money label="Available" dot="bg-bar-available" cents={ledger.fund.balanceCents} sub={waitingLine(ledger)} />
      </dl>
      <FundFlow className="mt-8" raised={ledger.fund.raisedCents} paid={ledger.fund.paidCents} reserved={ledger.fund.reservedCents} available={ledger.fund.balanceCents} legend={false} />
    </section>
  );
}

/** The same report without AG Studio: what the page shows if Studio cannot load. */
function PlainLedger({ ledger }: { ledger: Ledger }) {
  return (
    <div className="space-y-10">
      <FundTotals ledger={ledger} />
      <section aria-labelledby="grants" className="space-y-4">
        <h3 id="grants" className="font-semibold tracking-tight">
          Every grant
        </h3>
        {ledger.rows.length === 0 ? (
          <Empty>No grants yet. A row appears here the moment a case is approved.</Empty>
        ) : (
          <LedgerGridClient rows={ledger.rows} />
        )}
      </section>

      <section aria-labelledby="donations" className="space-y-4">
        <h3 id="donations" className="font-semibold tracking-tight">
          Every donation
        </h3>
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
    </div>
  );
}

function Money({ label, cents, sub, hero, dot }: { label: string; cents: number; sub?: string; hero?: boolean; dot?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        {dot && <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />}
        {label}
      </dt>
      <dd className={`mt-1 font-semibold tracking-[-0.03em] tabular-nums ${hero ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`}>{moneyWhole(cents)}</dd>
      {sub && <dd className="mt-1.5 text-[13px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 text-3xl font-semibold tracking-[-0.03em] tabular-nums">{value}</dd>
      <dd className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{sub}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
