// Shapes the operator console works with. `toRow` runs on the server; the client imports the types only.
import type { Decision } from "@/lib/agent/schema";
import { amountForCase } from "@/lib/agent/tools";
import type { CaseDoc } from "@/lib/db/types";

/** One grid row. Contact details are shown to operators (the humans the policy trusts), never to the model or the public. */
export function toRow(c: CaseDoc) {
  const paidMs = c.timestamps.paid?.toMillis();
  return {
    id: c.id,
    status: c.status,
    tier: c.tier ?? c.aiDecision?.tier ?? null,
    amountCents: amountForCase(c),
    requestedAmountCents: c.requestedAmountCents,
    zip: c.zip,
    lang: c.lang,
    householdSize: c.householdSize,
    name: c.contact.name,
    email: c.contact.email,
    eligibility: c.aiDecision?.eligibility ?? null,
    confidence: c.aiDecision?.confidence ?? null,
    redFlags: c.redFlags ?? [],
    dupMatches: (c.dupMatches ?? []).map((d) => d.caseId),
    secondEvaluationAgrees: c.secondEvaluationAgrees ?? null,
    humanApproved: c.humanDecision?.approved ?? null,
    ledgerSummary: c.aiDecision?.ledgerSummary ?? "",
    reservedCents: c.reservedCents ?? 0,
    payoutBatchId: c.payoutBatchId ?? null,
    createdAt: c.timestamps.created.toDate().toISOString(),
    evaluatedAt: c.timestamps.evaluated?.toDate().toISOString() ?? null,
    paidAt: c.timestamps.paid?.toDate().toISOString() ?? null,
    minutesToCash: paidMs ? Math.round((paidMs - c.timestamps.created.toMillis()) / 60_000) : null,
    photoCount: c.photos.length,
  };
}

export type OpsRow = ReturnType<typeof toRow>;

export interface OpsFund {
  currency: string;
  raisedCents: number;
  paidCents: number;
  reservedCents: number;
  balanceCents: number;
}

export interface OpsRun {
  id: string;
  trigger: string;
  caseId: string | null;
  status: "running" | "done" | "error";
  summary: string;
  cost: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; modelCalls: number } | null;
  ts: string;
  finishedAt: string | null;
  toolCalls: Array<{ name: string; args: unknown; policyClause: string | null; ms: number; at: string; error: string | null; result: unknown }>;
}

/** What the case side panel shows: the answer of /api/ops/cases/[id]. */
export interface CaseDetail {
  case: {
    id: string;
    status: string;
    lang: string;
    zip: string;
    householdSize: number | null;
    requestedAmountCents: number | null;
    narrative: string;
    /** Null for a visitor of the open demo console: contact details go to signed-in operators only. */
    contact: { name: string; email: string; phone?: string | null; address?: string | null } | null;
    tier?: number | null;
    aiDecision?: Decision;
    aiDecisionSecond?: Decision;
    secondEvaluationAgrees?: boolean;
    usableEvidenceCount?: number;
    approvedAmountCents?: number;
    humanDecision: { approved: boolean; by: string; amountCents?: number; note?: string; at: string } | null;
    redFlags?: string[];
    dupMatches?: Array<{ caseId: string; by: string[] }>;
    applicantMessage: { lang: string; text: string; at: string } | null;
    reservedCents?: number;
    payoutBatchId?: string;
    notes: Array<{ by: string; text: string; at: string }>;
    timestamps: Record<string, string | null>;
    evaluatingSince?: string | null;
    photoUrls: string[];
    docUrls: string[];
    /** Documents on file that a visitor of the open console is not shown (proof of address, IDs, receipts). */
    privateDocCount?: number;
  };
  /** P-4 photo matches: the file in this case and the same photo in the earlier case. */
  dupPhotos?: Array<{ caseId: string; thisUrl: string; otherUrl: string }>;
  payout: {
    status: string;
    outcome: string;
    batchStatus?: string;
    payoutBatchId?: string;
    amountCents: number;
    error?: string;
    /** PayPal did not accept the payout, or never answered: an operator may send it again. */
    retryable?: boolean;
    events: Array<{ type: string; status?: string; source: string; at: string }>;
    createdAt?: string;
    updatedAt?: string;
  } | null;
  /** Newest first. `from` and `to` are the statuses of a status change (absent for other entries). */
  audit: Array<{ actor: string; action: string; policyClause?: string; reason: string; ts: string; from?: string; to?: string }>;
}

/** Statuses an operator may act on from the grid. */
export const ACTIONABLE = new Set(["needs_review", "needs_info", "parked", "approved", "new", "evaluating"]);
