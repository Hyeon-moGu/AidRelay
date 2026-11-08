// /ops/audit: ask the ledger. Operators only, because every question is a paid model call.
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/site/brand";
import { POLICY, type Tier } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { moneyWhole } from "@/lib/format";
import { NEED_LABEL } from "@/lib/ledger/labels";
import { buildLedger } from "@/lib/ledger/public";
import { isOperator } from "@/lib/ops/auth";
import { AuditClient } from "./audit-client";

export const metadata: Metadata = { title: "Ledger auditor · AidRelay" };
export const dynamic = "force-dynamic";

/** The code-enforced numbers the auditor checks grants against, in words it can quote. */
function policyFacts(): string {
  const tiers = ([1, 2, 3, 4] as Tier[]).map((t) => `level ${t} (${NEED_LABEL[t]}) ${moneyWhole(POLICY.tierCents[t])}`).join(", ");
  const h = POLICY.household;
  return [
    `- Grant by level of need: ${tiers}.`,
    `- Households of more than ${h.beyond} people get ${moneyWhole(h.perMemberCents)} more per extra person, up to ${moneyWhole(h.maxCents)} more. A volunteer may set a different amount, up to ${moneyWhole((POLICY.tierCents[4] + h.maxCents) * POLICY.humanCapMultiplier)}.`,
    `- The AI case officer may pay on its own only grants of ${moneyWhole(getEnv().AUTO_APPROVE_LIMIT * 100)} or less with no red flags; everything else needs a volunteer. Only a volunteer can reject.`,
    `- One payout per household. Families who cannot be paid yet wait for funds and are paid by level of need, highest first, then in order of application.`,
  ].join("\n");
}

export default async function AuditPage() {
  if (!(await isOperator())) redirect("/ops/login");
  const ledger = await buildLedger();
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Brand href="/ops" suffix="Ledger auditor" />
        </div>
        <Link href="/ops" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to the queue
        </Link>
      </header>
      <p className="shrink-0 border-b border-border bg-accent/50 px-4 py-2 text-[13px] text-accent-foreground sm:px-6">
        Ask about the fund in plain English. The auditor reads only the anonymized ledger and cannot approve, pay or change anything; charts it
        adds stay in this tab and are never published.
      </p>
      <main id="main" className="min-h-0 flex-1">
        <AuditClient ledger={{ rows: ledger.rows, donations: ledger.donations, fund: ledger.fund }} licenseKey={getEnv().AG_STUDIO_LICENSE_KEY ?? ""} policyFacts={policyFacts()} />
      </main>
    </div>
  );
}
