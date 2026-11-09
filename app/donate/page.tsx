import { Check, Clock3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { POLICY } from "@/lib/agent/policy";
import { duration, moneyWhole, plural } from "@/lib/format";
import { buildLedger, type Ledger } from "@/lib/ledger/public";
import { DonateForm } from "./donate-form";
import { SANDBOX_DONOR } from "@/lib/demo-accounts";

export const metadata: Metadata = { title: "Donate · AidRelay" };
export const dynamic = "force-dynamic";

const PROMISES = [
  "Your donation appears on the public ledger within seconds, along with its PayPal record.",
  "Families who are approved and waiting are paid right away, starting with those in the greatest need.",
  "Your email never appears anywhere public, because the fund keeps only a one-way reference to it.",
];

async function loadLedger(): Promise<Ledger | null> {
  try {
    return await buildLedger();
  } catch {
    return null;
  }
}

/** Approved families the fund cannot pay yet, and how much more it would take to pay them all. */
function waitingForFunds(ledger: Ledger): { families: number; shortCents: number } | null {
  const parked = ledger.rows.filter((r) => r.status === "parked");
  const shortCents = parked.reduce((sum, r) => sum + (r.amountCents ?? 0), 0) - ledger.fund.balanceCents;
  return parked.length && shortCents > 0 ? { families: parked.length, shortCents } : null;
}

export default async function DonatePage() {
  // The client id is public; read at request time on the server so the Docker image needs no build-time env.
  // The secret never leaves lib/paypal/* on the server.
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
  const ledger = await loadLedger();
  const waiting = ledger && waitingForFunds(ledger);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="hero-glow flex-1">
        {/* Three blocks so a phone reads the pitch, then the amount picker, then the details. */}
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_440px] lg:gap-x-16 lg:gap-y-7">
          <div className="space-y-6 lg:col-start-1 lg:row-start-1">
            <p className="text-sm font-medium text-primary">Donate</p>
            <h1 className="max-w-[16ch] text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl">Fund a family’s next grant and watch it land.</h1>
            <p className="max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
              Your gift goes straight into the relief fund. If a family is already approved and waiting, the AI case officer pays them the moment
              your donation clears, and you can follow that payment on the{" "}
              <Link href="/ledger" className="font-medium text-primary hover:underline">
                public ledger
              </Link>
              .
            </p>
            {ledger && ledger.fund.raisedCents > 0 && (
              <p className="max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
                So far donors have given <strong className="font-semibold text-foreground">{moneyWhole(ledger.fund.raisedCents)}</strong>
                {ledger.metrics.casesPaid > 0 && (
                  <>
                    , and <strong className="font-semibold text-foreground">{moneyWhole(ledger.fund.paidCents)}</strong> has reached{" "}
                    <strong className="font-semibold text-foreground">{plural(ledger.metrics.casesPaid, "family", "families")}</strong>, typically{" "}
                    {duration(ledger.metrics.medianMinutesToCash)} after they applied
                  </>
                )}
                .
              </p>
            )}

            {waiting && (
              <p className="flex max-w-[54ch] items-start gap-3 rounded-2xl border border-border bg-card p-4 text-[15px] leading-relaxed">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-wait-soft text-wait">
                  <Clock3 className="size-4" />
                </span>
                <span>
                  <strong className="font-semibold">
                    {plural(waiting.families, "approved family is", "approved families are")} waiting right now.
                  </strong>{" "}
                  {moneyWhole(waiting.shortCents)} more would pay {waiting.families === 1 ? "them" : "all of them"} today.
                </span>
              </p>
            )}
          </div>

          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <DonateForm clientId={clientId} tierCents={POLICY.tierCents} />
          </div>

          <div className="space-y-6 lg:col-start-1 lg:row-start-2">
            <ul className="space-y-3.5">
              {PROMISES.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-relaxed">
                  <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            <div className="max-w-[54ch] rounded-xl bg-muted p-4 text-[13px] leading-relaxed text-muted-foreground">
              <p>This demo runs on the PayPal sandbox, so no real money moves. When the PayPal window opens, sign in with this test donor account:</p>
              <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-foreground" translate="no">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-mono text-[12.5px] break-all select-all">{SANDBOX_DONOR.email}</dd>
                <dt className="text-muted-foreground">Password</dt>
                <dd className="font-mono text-[12.5px] break-all select-all">{SANDBOX_DONOR.password}</dd>
              </dl>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
