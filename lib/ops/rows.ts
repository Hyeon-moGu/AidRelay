// Shapes the operator console works with. `toRow` runs on the server; the client imports the types only.
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

/** Statuses an operator may act on from the grid. */
export const ACTIONABLE = new Set(["needs_review", "needs_info", "parked", "approved", "new", "evaluating"]);
