// /ops/audit: ask the ledger. While the demo console is open anyone may look: the page holds only the public,
// anonymized ledger. Asking is for operators, because every question is a paid model call (/api/ops/ask).
import { ArrowLeft, LogIn } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site/site-header";
import { POLICY, type Tier } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { moneyWhole } from "@/lib/format";
import { NEED_LABEL } from "@/lib/ledger/labels";
import { buildLedger } from "@/lib/ledger/public";
import { opsAccess } from "@/lib/ops/auth";
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

const stripLink = "inline-flex shrink-0 items-center gap-1.5 font-medium whitespace-nowrap hover:underline";

export default async function AuditPage() {
  const access = await opsAccess();
  if (access === "none") redirect("/ops/login");
  const canAsk = access === "operator";
  const ledger = await buildLedger();
  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader staff={canAsk ? "operator" : "viewer"} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-border bg-accent/50 px-4 py-2 text-[13px] text-accent-foreground">
        <p className="min-w-0 flex-1 basis-80">
          {canAsk ? (
            "Ask about the fund in plain English. The auditor reads only the anonymized ledger and cannot approve, pay or change anything; charts it adds stay in this tab and are never published."
          ) : (
            <>
              <span className="font-semibold">Demo version, view only.</span> Every question is a real call to the model, so asking needs the staff sign-in. You can
              still explore the report and add charts by hand; nothing you change leaves this tab.
            </>
          )}
        </p>
        {!canAsk && (
          <Link href="/ops/login" className={stripLink}>
            <LogIn aria-hidden="true" className="size-4" />
            Sign in to ask
          </Link>
        )}
        <Link href="/ops" className={stripLink}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to the queue
        </Link>
      </div>
      <main id="main" className="min-h-0 flex-1">
        <AuditClient
          ledger={{ rows: ledger.rows, donations: ledger.donations, fund: ledger.fund }}
          licenseKey={getEnv().AG_STUDIO_LICENSE_KEY ?? ""}
          policyFacts={policyFacts()}
          canAsk={canAsk}
        />
      </main>
    </div>
  );
}
