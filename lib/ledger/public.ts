// The public ledger: totals, live metrics and anonymized per-case rows. No PII ever leaves this module
// (zip prefix only, no names/contact, only the scrubbed ledgerSummary as AI text). Server-only.
import { amountForCase } from "@/lib/agent/tools";
import { listAllCases } from "@/lib/db/repos/cases";
import { listRecentDonations } from "@/lib/db/repos/donations";
import { getFund } from "@/lib/db/repos/fund";
import { fundBalanceCents, type CaseDoc } from "@/lib/db/types";
import { zipPrefix } from "@/lib/ledger/anonymize";
import { publicSummary } from "@/lib/ledger/labels";

/** Cases that appear as rows: money is committed or waiting. Everything else is counted, not listed. */
const LISTED = new Set(["approved", "parked", "paying", "paid"]);

export interface LedgerRow {
  caseId: string;
  status: string;
  zipPrefix: string;
  tier: number | null;
  amountCents: number | null;
  summary: string;
  humanReviewed: boolean;
  payoutBatchId: string | null;
  receivedAt: string;
  paidAt: string | null;
  minutesToCash: number | null;
}

export interface Ledger {
  fund: { name: string; currency: string; raisedCents: number; paidCents: number; reservedCents: number; balanceCents: number; policyVersion: string };
  metrics: {
    casesTotal: number;
    casesPaid: number;
    casesWaiting: number;
    casesInReview: number;
    medianMinutesToCash: number | null;
    autoPaidShare: number | null;
    duplicatePayouts: number;
    paidWithBatchIdShare: number | null;
  };
  rows: LedgerRow[];
  donations: Array<{ capturedAt: string; amountCents: number; currency: string; captureId: string }>;
  generatedAt: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function toLedgerRow(c: CaseDoc): LedgerRow {
  const paidMs = c.timestamps.paid?.toMillis();
  return {
    caseId: c.id,
    status: c.status,
    zipPrefix: zipPrefix(c.zip),
    tier: c.tier ?? c.aiDecision?.tier ?? null,
    amountCents: amountForCase(c),
    summary: publicSummary(c.aiDecision?.ledgerSummary ?? ""),
    humanReviewed: !!c.humanDecision,
    payoutBatchId: c.payoutBatchId ?? null,
    receivedAt: c.timestamps.created.toDate().toISOString(),
    paidAt: c.timestamps.paid?.toDate().toISOString() ?? null,
    minutesToCash: paidMs ? Math.round((paidMs - c.timestamps.created.toMillis()) / 60_000) : null,
  };
}

export async function buildLedger(): Promise<Ledger> {
  const [fund, cases, donations] = await Promise.all([getFund(), listAllCases(), listRecentDonations(50)]);
  const paid = cases.filter((c) => c.status === "paid");
  const rows = cases
    .filter((c) => LISTED.has(c.status))
    .map(toLedgerRow)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const minutes = paid.map((c) => (c.timestamps.paid!.toMillis() - c.timestamps.created.toMillis()) / 60_000);
  const seenBatches = new Map<string, number>();
  for (const c of cases) if (c.payoutBatchId) seenBatches.set(c.payoutBatchId, (seenBatches.get(c.payoutBatchId) ?? 0) + 1);

  return {
    fund: {
      name: fund.name,
      currency: fund.currency,
      raisedCents: fund.raisedCents,
      paidCents: fund.paidCents,
      reservedCents: fund.reservedCents,
      balanceCents: fundBalanceCents(fund),
      policyVersion: fund.policyVersion,
    },
    metrics: {
      casesTotal: cases.length,
      casesPaid: paid.length,
      casesWaiting: cases.filter((c) => c.status === "parked").length,
      casesInReview: cases.filter((c) => ["new", "evaluating", "needs_info", "needs_review"].includes(c.status)).length,
      medianMinutesToCash: median(minutes.map((m) => Math.round(m * 10) / 10)),
      autoPaidShare: paid.length ? paid.filter((c) => !c.humanDecision?.approved).length / paid.length : null,
      duplicatePayouts: [...seenBatches.values()].filter((n) => n > 1).length,
      paidWithBatchIdShare: paid.length ? paid.filter((c) => !!c.payoutBatchId).length / paid.length : null,
    },
    rows,
    donations: donations.map((d) => ({ capturedAt: d.capturedAt!.toDate().toISOString(), amountCents: d.amountCents, currency: d.currency, captureId: d.captureId ?? "" })),
    generatedAt: new Date().toISOString(),
  };
}
