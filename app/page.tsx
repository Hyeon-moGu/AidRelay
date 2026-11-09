import { ArrowRight, Ban, CopyX, EyeOff, FileText, HandCoins, Scale, ScrollText, Send, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { FundFlow } from "@/components/fund-flow";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { POLICY } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { buildLedger, type Ledger, type LedgerRow } from "@/lib/ledger/public";
import { NEED_LABEL } from "@/lib/ledger/labels";
import { duration, moneyWhole, num, percent } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: HandCoins,
    title: "You give through PayPal",
    body: "Your donation is captured by PayPal and shows up on the public ledger within seconds, with its PayPal record attached.",
  },
  {
    icon: FileText,
    title: "A family applies from a phone",
    body: "Three short screens in English or Spanish and a photo of the damage are all it takes, and the family gets a private link to follow along.",
  },
  {
    icon: ShieldCheck,
    title: "The AI case officer reviews it",
    body: "It reads the story and the photos against the fund’s rules, names the rule behind every decision and hands anything uncertain to a volunteer.",
  },
  {
    icon: Send,
    title: "PayPal delivers the grant",
    body: "Approved families are paid through PayPal Payouts, the greatest need first, and the payment appears on the ledger the moment PayPal accepts it.",
  },
];

/** What the agent can never do. The auto-approve limit comes from the same setting the guardrails enforce. */
const never = (autoLimitCents: number) => [
  { icon: Ban, title: "Turn anyone away", body: "Only a volunteer can decline an application. The most it can do is ask a person to take a look." },
  { icon: Scale, title: "Pay large or unclear cases alone", body: `Anything over ${moneyWhole(autoLimitCents)}, or with a single red flag, waits until a volunteer approves it.` },
  { icon: CopyX, title: "Pay a household twice", body: "Each case gets exactly one PayPal payout, and PayPal itself refuses a repeat." },
  { icon: Wallet, title: "Spend money the fund doesn’t have", body: "Money is set aside before every payout, and families wait in line when the fund runs short." },
  { icon: EyeOff, title: "Reveal who someone is", body: "The ledger shows a zip prefix and a one-line summary, never a name, an address or a phone number." },
  { icon: ScrollText, title: "Act without a paper trail", body: "Every step it takes is logged together with the rule it relied on." },
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
  const grantCents = POLICY.tierCents[2];

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="hero-glow">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-14 lg:pb-24">
            <div className="space-y-7">
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-[13px] text-muted-foreground">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                {ledger ? `Live now: ${ledger.fund.name}` : "Community disaster relief, run in the open"}
              </p>
              <h1 className="max-w-[15ch] text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.04em] sm:text-6xl lg:text-[4.25rem]">
                Flood relief that arrives in minutes, not weeks.
              </h1>
              <p className="max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
                A family flooded out of its home needs cash for food and a dry bed today. <span translate="no">AidRelay</span>’s AI case officer
                checks each application against the rules the fund’s volunteers wrote, pays the families who qualify through PayPal and shows every
                dollar on a public ledger.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/donate"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97]"
                >
                  Give to the fund
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
                <Link
                  href="/ledger"
                  className="inline-flex h-12 items-center justify-center rounded-lg border border-input/60 bg-card px-6 text-[15px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.97]"
                >
                  See where the money went
                </Link>
              </div>
              <p className="text-sm text-muted-foreground">
                Affected by the flood?{" "}
                <Link href="/apply" className="font-medium text-primary hover:underline">
                  Apply for help in about five minutes
                </Link>
              </p>
              {getEnv().OPS_PUBLIC_VIEW && (
                <p className="text-sm text-muted-foreground">
                  Want to see how volunteers keep watch over the AI?{" "}
                  <Link href="/ops" className="font-medium text-primary hover:underline">
                    Look inside the staff console
                  </Link>
                </p>
              )}
            </div>

            <LiveFund ledger={ledger} />
          </div>
        </section>

        {ledger && ledger.metrics.casesPaid > 0 && <Proof ledger={ledger} />}

        <section aria-labelledby="how" className="border-y border-border/70 bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <p className="text-sm font-medium text-primary">How it works</p>
            <h2 id="how" className="mt-2 max-w-[24ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
              From your donation to a family’s PayPal account.
            </h2>
            <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 sm:gap-10 lg:grid-cols-4 lg:gap-8">
              <span aria-hidden="true" className="absolute top-5 right-[calc(25%-44px)] left-5 hidden h-px bg-gradient-to-r from-primary/60 via-primary/30 to-bar-paid/60 lg:block" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative grid grid-cols-[2.5rem_1fr] gap-x-4 gap-y-1 lg:block lg:space-y-3">
                  <span className="relative row-span-3 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground ring-8 ring-card">
                    <s.icon aria-hidden="true" className="size-[18px]" />
                  </span>
                  <p className="pt-0.5 text-xs font-medium text-muted-foreground tabular-nums lg:pt-2">Step {i + 1}</p>
                  <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="never" className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="space-y-4">
            <p className="text-sm font-medium text-primary">Safeguards</p>
            <h2 id="never" className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
              Fast, but never reckless.
            </h2>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              The AI case officer can recommend anything, but code decides whether money moves, so no clever application or prompt can talk its way
              past these limits. It will never:
            </p>
          </div>
          <div className="space-y-8">
            <ul className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
              {never(getEnv().AUTO_APPROVE_LIMIT * 100).map((n) => (
                <li key={n.title} className="flex gap-3.5">
                  <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <n.icon className="size-[18px]" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{n.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{n.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/policy" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              Read the rules it follows
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </section>

        <section aria-labelledby="cta" className="px-4 pb-20 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 rounded-3xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between dark:bg-accent dark:text-foreground dark:ring-1 dark:ring-primary/30 dark:ring-inset">
            <div className="space-y-2">
              <h2 id="cta" className="max-w-[22ch] text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
                {moneyWhole(grantCents)} is a full grant for a family whose home flooded.
              </h2>
              <p className="max-w-[52ch] text-[17px] leading-relaxed opacity-85">
                If someone is already approved and waiting, your donation pays them right away, and you can watch it happen on the ledger.
              </p>
            </div>
            <Link
              href="/donate"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-primary-foreground px-6 text-[15px] font-semibold text-primary transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.97] lg:self-center dark:bg-primary dark:text-primary-foreground"
            >
              Donate now
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

/** One band of real numbers between the hero and the explainer. */
function Proof({ ledger }: { ledger: Ledger }) {
  const { metrics, fund } = ledger;
  const items = [
    { value: moneyWhole(fund.paidCents), label: `paid to ${num(metrics.casesPaid)} households` },
    { value: duration(metrics.medianMinutesToCash), label: "typical time from applying to cash" },
    { value: percent(metrics.autoPaidShare), label: "of families paid without waiting for a volunteer" },
    { value: num(metrics.duplicatePayouts), label: "households paid twice" },
  ];
  return (
    <section aria-label="The fund so far" className="border-t border-border/70">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:px-6 lg:grid-cols-4">
        {items.map((it) => (
          <div key={it.label}>
            <dd className="text-3xl font-semibold tracking-[-0.03em] tabular-nums sm:text-4xl">{it.value}</dd>
            <dt className="mt-1 text-sm text-muted-foreground">{it.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

function since(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

function LiveFund({ ledger }: { ledger: Ledger | null }) {
  if (!ledger) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        The fund’s live numbers will appear here as soon as the ledger is connected.
      </div>
    );
  }
  const { fund } = ledger;
  const now = Date.parse(ledger.generatedAt);
  const recent: LedgerRow[] = ledger.rows
    .filter((r) => r.status === "paid" && r.paidAt)
    .sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? ""))
    .slice(0, 3);
  return (
    <section aria-labelledby="live" className="min-w-0 rounded-3xl border border-border bg-card p-6 shadow-[0_24px_60px_-28px_rgba(15,107,112,0.35)] sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 id="live" className="text-sm font-medium text-muted-foreground">
          Raised so far
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          Live
        </span>
      </div>
      <p className="mt-1 text-5xl font-semibold tracking-[-0.04em] tabular-nums">{moneyWhole(fund.raisedCents)}</p>
      <FundFlow className="mt-6" raised={fund.raisedCents} paid={fund.paidCents} reserved={fund.reservedCents} available={fund.balanceCents} />

      {recent.length > 0 && (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Latest payouts</h3>
          <ul className="mt-3 space-y-3">
            {recent.map((r) => (
              <li key={r.caseId} className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.summary || (r.tier ? NEED_LABEL[r.tier] : "Grant")}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.tier ? `${NEED_LABEL[r.tier]} · ` : ""}
                    {r.humanReviewed ? "approved by a volunteer" : "approved by the AI case officer"} · paid {since(r.paidAt!, now)}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-success tabular-nums">{moneyWhole(r.amountCents ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/ledger" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        Open the public ledger
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}
