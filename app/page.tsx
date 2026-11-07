import { ArrowRight, CopyX, EyeOff, FileText, HandCoins, Scale, ScrollText, Send, ShieldCheck, UserCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { FundFlow } from "@/components/fund-flow";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { buildLedger, type Ledger } from "@/lib/ledger/public";
import { duration, moneyWhole, num } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: HandCoins, title: "Donors give through PayPal", body: "Each capture lands on the public ledger with its PayPal record id, within seconds." },
  { icon: FileText, title: "Survivors apply from a phone", body: "Three short screens in English or Spanish, a few photos, and a private link to follow the case." },
  { icon: ShieldCheck, title: "The Case Officer checks the policy", body: "It reads the story and photos, cites the clause behind every decision, and sends anything unclear to a volunteer." },
  { icon: Send, title: "PayPal Payouts delivers the cash", body: "Approved grants are paid in policy order. The batch id goes on the ledger the moment PayPal accepts it." },
];

const NEVER = [
  { icon: UserCheck, title: "Reject anyone on its own", body: "Only a volunteer can turn an application down." },
  { icon: Scale, title: "Pay large or unclear cases unattended", body: "Above $250, or with any red flag, a human approves first." },
  { icon: CopyX, title: "Pay a household twice", body: "One payout per case, enforced by the PayPal batch id." },
  { icon: Wallet, title: "Spend money the fund does not have", body: "Funds are reserved before any payout is created." },
  { icon: EyeOff, title: "Publish who someone is", body: "The ledger shows a zip prefix and a one-line summary, never a name or contact." },
  { icon: ScrollText, title: "Act without a record", body: "Every tool call is logged with the policy clause it relied on." },
];

async function loadLedger(): Promise<Ledger | null> {
  try {
    return await buildLedger();
  } catch (err) {
    console.error("[home] live numbers unavailable", err);
    return null;
  }
}

export default async function Home() {
  const ledger = await loadLedger();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:pb-24">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              Community disaster relief, run in the open
            </p>
            <h1 className="max-w-[16ch] text-4xl leading-[1.05] font-semibold tracking-[-0.03em] sm:text-5xl lg:text-[3.5rem]">
              Cash in a survivor’s hands in minutes, not weeks.
            </h1>
            <p className="max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
              <span translate="no">AidRelay</span> is an autonomous case officer for community relief funds. It checks each application against the
              fund’s published policy, pays approved households through PayPal, and records every dollar on a public ledger.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/ledger"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97]"
              >
                See where the money goes
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link
                href="/apply"
                className="inline-flex h-12 items-center justify-center rounded-lg border border-input/60 bg-card px-5 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.97]"
              >
                Apply for help
              </Link>
            </div>
          </div>

          <LiveFund ledger={ledger} />
        </section>

        <section aria-labelledby="how" className="border-y border-border/70 bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="how" className="text-2xl font-semibold tracking-tight">
              How a grant moves
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <s.icon aria-hidden="true" className="size-[18px]" />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">0{i + 1}</span>
                  </div>
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="never" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <div className="space-y-4">
            <h2 id="never" className="text-2xl font-semibold tracking-tight">
              What the agent will never do
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              These limits live in code, not in a prompt. The model can recommend; the guardrails decide whether money can move. The full policy is
              published next to the ledger.
            </p>
            <Link href="/ledger#policy" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Read the policy
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {NEVER.map((n) => (
              <li key={n.title} className="flex gap-3">
                <n.icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h3 className="font-medium">{n.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function LiveFund({ ledger }: { ledger: Ledger | null }) {
  if (!ledger) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        The fund’s live numbers appear here once the ledger is connected.
      </div>
    );
  }
  const { fund, metrics } = ledger;
  return (
    <section aria-labelledby="live" className="rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(20,24,28,0.04)] sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 id="live" className="text-sm font-medium text-muted-foreground">
          Live from {fund.name}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          Live
        </span>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">Raised</p>
      <p className="text-4xl font-semibold tracking-[-0.03em] tabular-nums">{moneyWhole(fund.raisedCents)}</p>
      <FundFlow className="mt-5" raised={fund.raisedCents} paid={fund.paidCents} reserved={fund.reservedCents} available={fund.balanceCents} />
      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-5">
        <div>
          <dt className="text-xs text-muted-foreground">Paid out</dt>
          <dd className="mt-1 font-semibold tabular-nums">{moneyWhole(fund.paidCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Households</dt>
          <dd className="mt-1 font-semibold tabular-nums">{num(metrics.casesPaid)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Median to cash</dt>
          <dd className="mt-1 font-semibold tabular-nums">{duration(metrics.medianMinutesToCash)}</dd>
        </div>
      </dl>
      <Link href="/ledger" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        Open the public ledger
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
