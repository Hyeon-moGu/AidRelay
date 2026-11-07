// Rules the agent cannot talk its way around (AGENTS.md §1). Pure functions; every branch is unit-tested.
import { AGENT_WRITABLE_STATUSES, type CaseStatus, type Decision, type RedFlag } from "@/lib/agent/schema";
import { POLICY, type Tier } from "@/lib/agent/policy";

export type GuardrailCode =
  | "agent_cannot_reject"
  | "bad_amount"
  | "status_not_payable"
  | "prior_payout"
  | "insufficient_funds"
  | "no_decision"
  | "not_eligible"
  | "below_min_tier"
  | "over_auto_limit"
  | "low_confidence"
  | "red_flags";

export class GuardrailError extends Error {
  constructor(
    public readonly code: GuardrailCode,
    message: string,
    /** Policy clause the refusal relies on. */
    public readonly clause: string,
  ) {
    super(message);
    this.name = "GuardrailError";
  }
}

/** AGENTS.md §1.2 — the agent may never set `rejected`. */
export function assertAgentStatusWrite(status: CaseStatus): void {
  if (!AGENT_WRITABLE_STATUSES.includes(status)) {
    throw new GuardrailError("agent_cannot_reject", `agent may not set status ${status}`, "P-9");
  }
}

export interface AutoApproveLimits {
  /** AUTO_APPROVE_LIMIT, in cents. */
  limitCents: number;
  /** AUTO_APPROVE_MIN_CONFIDENCE */
  minConfidence: number;
  minTier: Tier;
}

export type AutoApproveResult = { ok: true } | { ok: false; code: GuardrailCode; clause: string; detail: string };

/** P-9 conditions 1–5 (the decision-based ones). 6 and 7 are checked in assertPayable with live data. */
export function autoApproveCheck(decision: Decision | undefined, amountCents: number, limits: AutoApproveLimits): AutoApproveResult {
  if (!decision) return { ok: false, code: "no_decision", clause: "P-9", detail: "no evaluation on file" };
  if (decision.eligibility !== "eligible") {
    return { ok: false, code: "not_eligible", clause: "P-9.1", detail: `eligibility is ${decision.eligibility}` };
  }
  if (decision.tier === null || decision.tier < limits.minTier) {
    return { ok: false, code: "below_min_tier", clause: "P-9.2", detail: `tier ${decision.tier} < ${limits.minTier}` };
  }
  if (amountCents > limits.limitCents) {
    return { ok: false, code: "over_auto_limit", clause: "P-9.3", detail: `${amountCents} > ${limits.limitCents}` };
  }
  if (decision.confidence < limits.minConfidence) {
    return { ok: false, code: "low_confidence", clause: "P-9.4", detail: `${decision.confidence} < ${limits.minConfidence}` };
  }
  if (decision.redFlags.length > 0) {
    return { ok: false, code: "red_flags", clause: "P-9.5", detail: decision.redFlags.join(", ") };
  }
  return { ok: true };
}

export interface PayableInput {
  caseStatus: CaseStatus;
  aiDecision?: Decision;
  humanApproved: boolean;
  amountCents: number;
  /** raised − paid − reserved, i.e. not counting this case's own reservation. */
  fundBalanceCents: number;
  /** Amount already reserved for this case (0 if none). */
  caseReservedCents: number;
  /** A payouts/{caseId} record exists (any status). */
  existingPayout: boolean;
  limits: AutoApproveLimits;
}

export type PayablePath = "human" | "auto";

/**
 * Throws unless the payout is allowed: a named human approved it, OR every P-9 auto-approve
 * condition holds. Invariants §1.3 (one payout per case) and §1.4 (never overdraw) apply to both paths.
 */
export function assertPayable(input: PayableInput): { path: PayablePath } {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new GuardrailError("bad_amount", `amount must be a positive integer of cents, got ${input.amountCents}`, "P-7");
  }
  if (input.existingPayout || input.caseStatus === "paying" || input.caseStatus === "paid") {
    throw new GuardrailError("prior_payout", "a payout already exists for this case", "P-9.7");
  }
  if (input.caseStatus === "rejected") {
    throw new GuardrailError("status_not_payable", "case was rejected by a human", "P-9");
  }
  if (input.fundBalanceCents + input.caseReservedCents < input.amountCents) {
    throw new GuardrailError(
      "insufficient_funds",
      `balance ${input.fundBalanceCents + input.caseReservedCents} < ${input.amountCents}`,
      "P-9.6",
    );
  }
  if (input.humanApproved) return { path: "human" };

  const auto = autoApproveCheck(input.aiDecision, input.amountCents, input.limits);
  if (!auto.ok) throw new GuardrailError(auto.code, `auto-approve refused: ${auto.detail}`, auto.clause);
  return { path: "auto" };
}

/** Flags that always need a human, as opposed to `zip_outside_declared_area`, which P-2 turns into a question. */
export const REVIEW_FLAGS: readonly RedFlag[] = [
  "duplicate_photo_hash",
  "duplicate_address",
  "duplicate_contact",
  "amount_outlier",
  "evidence_mismatch",
];

export type NextStatus = Extract<CaseStatus, "needs_info" | "needs_review" | "parked" | "approved">;

/**
 * Where a freshly evaluated case goes. `ineligible` never becomes `rejected`:
 * it lands in the human queue with the agent's reasons attached.
 */
export function decideStatus(decision: Decision, amountCents: number | null, limits: AutoApproveLimits, fundsAvailable: boolean): {
  status: NextStatus;
  clause: string;
  reason: string;
} {
  const reviewFlags = decision.redFlags.filter((f) => REVIEW_FLAGS.includes(f));
  if (reviewFlags.length > 0) {
    return { status: "needs_review", clause: "P-4", reason: `red flags: ${reviewFlags.join(", ")}` };
  }
  if (decision.eligibility === "needs_info" || decision.redFlags.includes("zip_outside_declared_area")) {
    return { status: "needs_info", clause: decision.redFlags.length ? "P-2" : "P-5", reason: "more information needed" };
  }
  if (decision.eligibility === "ineligible") {
    return { status: "needs_review", clause: "P-9", reason: "agent finds the case ineligible; only a human may reject" };
  }
  if (amountCents === null) {
    return { status: "needs_review", clause: "P-7", reason: "eligible but no recommended amount" };
  }
  const auto = autoApproveCheck(decision, amountCents, limits);
  if (!auto.ok) return { status: "needs_review", clause: auto.clause, reason: auto.detail };
  if (!fundsAvailable) return { status: "parked", clause: "P-8", reason: "fund balance too low; re-evaluated on the next donation" };
  return { status: "approved", clause: "P-9", reason: "all auto-approve conditions hold" };
}

export function limitsFromEnv(env: { AUTO_APPROVE_LIMIT: number; AUTO_APPROVE_MIN_CONFIDENCE: number }): AutoApproveLimits {
  return {
    limitCents: env.AUTO_APPROVE_LIMIT * 100,
    minConfidence: env.AUTO_APPROVE_MIN_CONFIDENCE,
    minTier: POLICY.autoApproveMinTier,
  };
}
