// The fund's rules in plain language, with the full policy text the agent reads on every decision underneath.
// Every number here comes from the code-enforced policy (lib/agent/policy.ts) or the env limits.
import { ChevronDown, EyeOff, HandHelping, MapPin, ShieldBan, UserCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { marked } from "marked";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { loadPolicyText, POLICY, type Tier } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { moneyWhole, num } from "@/lib/format";
import { NEED_DETAIL, NEED_LABEL } from "@/lib/ledger/labels";

export const metadata: Metadata = { title: "How it decides · AidRelay" };
export const dynamic = "force-dynamic";

const TIERS: Tier[] = [1, 2, 3, 4];

/** The policy as the agent reads it, minus its title, the note to maintainers and the internal change log. */
function publicPolicyHtml(markdown: string): string {
  const firstSection = markdown.indexOf("\n## ");
  const body = (firstSection >= 0 ? markdown.slice(firstSection + 1) : markdown).replace(/\n## \d+\. Change log[\s\S]*$/, "\n");
  return marked.parse(body) as string;
}

export default async function PolicyPage() {
  const policyHtml = publicPolicyHtml(await loadPolicyText());
  const autoLimit = getEnv().AUTO_APPROVE_LIMIT * 100;
  const { perMemberCents, maxCents, beyond } = POLICY.household;
  const { maxAutoPayoutsPerHour, maxAutoPaidCentsPer24h } = POLICY.velocity;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="hero-glow border-b border-border/70">
          <div className="mx-auto max-w-6xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
            <p className="text-sm font-medium text-primary">How it decides</p>
            <h1 className="mt-3 max-w-[20ch] text-4xl leading-[1.05] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              Who gets help, how much, and who decides.
            </h1>
            <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-muted-foreground">
              The fund’s volunteers wrote these rules before the first application arrived. The AI case officer applies them to every case and names
              the rule behind each decision. The limits that protect the money live in code, where no application or prompt can talk its way past
              them.
            </p>
          </div>
        </section>

        <div className="mx-auto w-full max-w-6xl space-y-14 px-4 py-10 sm:px-6 sm:py-14">
          <section aria-labelledby="amounts" className="space-y-5">
            <div className="space-y-2">
              <h2 id="amounts" className="text-xl font-semibold tracking-tight">
                How much a family receives
              </h2>
              <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
                The grant depends on how hard the flood hit, not on how much someone asks for. Households of more than {num(beyond)} receive{" "}
                {moneyWhole(perMemberCents)} more for each extra person, up to {moneyWhole(maxCents)} more.
              </p>
            </div>
            {/* One card with a row per level on phones, four cards side by side from sm up. */}
            <ol className="divide-y divide-border rounded-2xl border border-border bg-card sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0 sm:rounded-none sm:border-0 sm:bg-transparent lg:grid-cols-4">
              {TIERS.map((t) => (
                <li key={t} className="flex gap-4 p-4 sm:flex-col sm:gap-0 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-5">
                  <span className="w-20 shrink-0 sm:w-auto">
                    <span className="hidden text-[13px] font-medium text-muted-foreground sm:block">Level {t}</span>
                    <span className="block text-2xl font-semibold tracking-[-0.03em] tabular-nums sm:mt-2 sm:text-3xl">{moneyWhole(POLICY.tierCents[t])}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium sm:mt-3">{NEED_LABEL[t]}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{NEED_DETAIL[t]}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="essentials" className="space-y-5">
            <h2 id="essentials" className="text-xl font-semibold tracking-tight">
              The rest, in plain words
            </h2>
            <ul className="grid gap-x-10 gap-y-8 md:grid-cols-2">
              <Rule icon={MapPin} title="Who can get help">
                Any household whose home is in the declared flood area, which covers every zip code starting with {POLICY.areaZipPrefix}. One photo or
                document of the damage is enough to apply, and each household can be helped once.
              </Rule>
              <Rule icon={UserCheck} title="When a volunteer steps in">
                The AI case officer pays on its own only when the grant is {moneyWhole(autoLimit)} or less, nothing about the case looks wrong, and a second,
                independent check agrees. Everything else waits for a volunteer, and only a volunteer can turn an application down.
              </Rule>
              <Rule icon={Wallet} title="When money runs short">
                Families in the greatest need are paid first, then everyone else in the order they applied. Anyone approved but not yet paid is paid
                automatically when the next donation arrives.
              </Rule>
              <Rule icon={HandHelping} title="How much the AI case officer can do alone">
                Even within those limits, it pays at most {num(maxAutoPayoutsPerHour)} grants an hour and {moneyWhole(maxAutoPaidCentsPer24h)} a day
                without a person. Beyond that, cases wait for a volunteer.
              </Rule>
              <Rule icon={ShieldBan} title="What the AI case officer can never do">
                Turn an application down, pay the same household twice or spend money the fund does not have. Those checks run in code, outside its
                reach.
              </Rule>
              <Rule icon={EyeOff} title="What stays private">
                The public ledger shows the first three digits of a zip code, the level of need, the amount and a one-line summary. Names, addresses,
                contact details and photos are never published.
              </Rule>
            </ul>
          </section>

          <section aria-labelledby="full" className="space-y-4">
            <details className="group rounded-2xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-6 sm:p-8 [&::-webkit-details-marker]:hidden">
                <span>
                  <span id="full" className="block text-lg font-semibold tracking-tight">
                    Read the complete rulebook
                  </span>
                  <span className="mt-1 block text-[15px] text-muted-foreground">
                    The exact text the AI case officer reads on every case. The rule numbers (P-1 to P-10) are what it cites when it explains a decision.
                  </span>
                </span>
                <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <article className="policy border-t border-border p-6 text-sm sm:p-8" dangerouslySetInnerHTML={{ __html: policyHtml }} />
            </details>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Rule({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
