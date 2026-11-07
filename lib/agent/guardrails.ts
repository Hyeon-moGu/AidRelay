// Rules the agent cannot talk its way around (AGENTS.md §1). Pure functions; every branch is unit-tested.
import { AGENT_WRITABLE_STATUSES, type CaseStatus, type Decision, type RedFlag } from "@/lib/agent/schema";
import { humanMaxCents, POLICY, type Tier } from "@/lib/agent/policy";

export type GuardrailCode =
  | "agent_cannot_reject"
  | "illegal_transition"
  | "human_override"
  | "bad_amount"
  | "status_not_payable"
  | "prior_payout"
  | "insufficient_funds"
  | "over_human_cap"
  | "no_decision"
  | "not_eligible"
  | "below_min_tier"
  | "over_auto_limit"
  | "low_confidence"
  | "red_flags"
  | "no_evidence"
  | "no_second_evaluation"
  | "velocity_limit";

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

/** AGENTS.md §1.2, the agent may never set `rejected`. (The full state machine is in transitions.ts.) */
export function assertAgentStatusWrite(status: CaseStatus): void {
  if (!AGENT_WRITABLE_STATUSES.includes(status)) {
    throw new GuardrailError("agent_cannot_reject", `agent may not set status ${status}`, "P-9");
  }
}

export interface VelocityLimits {
  maxAutoPayoutsPerHour: number;
  maxAutoPaidCentsPer24h: number;
}

export interface AutoApproveLimits {
  /** AUTO_APPROVE_LIMIT, in cents (P-9.3). */
  limitCents: number;
  /** AUTO_APPROVE_MIN_CONFIDENCE (P-9.4). */
  minConfidence: number;
  /** P-9.2 */
  minTier: Tier;
  /** P-9.8 / P-3: usable photos or documents an auto-paid case must have. */
  minUsableEvidence: number;
  /** P-7: ceiling for an amount a human sets. */
  humanMaxCents: number;
  /** P-9.9: an unattended payout needs a second, independent evaluation that agrees (AUTO_APPROVE_DOUBLE_CHECK). */
  requireSecondEvaluation: boolean;
  /** P-10 */
  velocity: VelocityLimits;
}

export type AutoApproveResult = { ok: true } | { ok: false; code: GuardrailCode; clause: string; detail: string };

/** P-9 conditions 1–5 and 8 (the decision-based ones). 6, 7, 9 and 10 are checked with live data. */
export function autoApproveCheck(
  decision: Decision | undefined,
  amountCents: number,
  limits: AutoApproveLimits,
  usableEvidence?: number,
): AutoApproveResult {
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
  if (usableEvidence !== undefined && usableEvidence < limits.minUsableEvidence) {
    return { ok: false, code: "no_evidence", clause: "P-9.8", detail: `${usableEvidence} usable photo(s)/document(s), need ${limits.minUsableEvidence}` };
  }
  return { ok: true };
}

export interface RecentAutoPayout {
  amountCents: number;
  atMs: number;
}

/** P-10: rolling-window limits on what the agent pays without a human. Pure. */
export function velocityCheck(recent: readonly RecentAutoPayout[], amountCents: number, nowMs: number, limits: VelocityLimits): AutoApproveResult {
  const hourAgo = nowMs - 3_600_000;
  const dayAgo = nowMs - 86_400_000;
  const countLastHour = recent.filter((r) => r.atMs >= hourAgo).length;
  if (countLastHour + 1 > limits.maxAutoPayoutsPerHour) {
    return { ok: false, code: "velocity_limit", clause: "P-10", detail: `${countLastHour} auto payouts in the last hour, limit ${limits.maxAutoPayoutsPerHour}` };
  }
  const sumLastDay = recent.filter((r) => r.atMs >= dayAgo).reduce((s, r) => s + r.amountCents, 0);
  if (sumLastDay + amountCents > limits.maxAutoPaidCentsPer24h) {
    return { ok: false, code: "velocity_limit", clause: "P-10", detail: `${sumLastDay + amountCents} cents in 24h would exceed ${limits.maxAutoPaidCentsPer24h}` };
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
  /** Usable photos/documents on file; unknown counts as none for the auto path. */
  usableEvidenceCount?: number;
  /** P-9.9: whether the second evaluation agreed on eligibility and tier; unknown counts as no. */
  secondEvaluationAgrees?: boolean;
  /** Auto payouts in the last 24 h (for P-10); omit to skip the velocity check. */
  recentAutoPayouts?: readonly RecentAutoPayout[];
  nowMs?: number;
  limits: AutoApproveLimits;
}

export type PayablePath = "human" | "auto";

/**
 * Throws unless the payout is allowed: a named human approved it (within the P-7 ceiling), OR every
 * P-9 auto-approve condition holds. Invariants §1.3 (one payout per case) and §1.4 (never overdraw) apply to both paths.
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
  if (input.humanApproved) {
    if (input.amountCents > input.limits.humanMaxCents) {
      throw new GuardrailError("over_human_cap", `${input.amountCents} exceeds the human ceiling ${input.limits.humanMaxCents}`, "P-7");
    }
    return { path: "human" };
  }

  const auto = autoApproveCheck(input.aiDecision, input.amountCents, input.limits, input.usableEvidenceCount ?? 0);
  if (!auto.ok) throw new GuardrailError(auto.code, `auto-approve refused: ${auto.detail}`, auto.clause);
  if (input.limits.requireSecondEvaluation && input.secondEvaluationAgrees !== true) {
    throw new GuardrailError("no_second_evaluation", "auto-approve refused: no agreeing second evaluation on file", "P-9.9");
  }
  if (input.recentAutoPayouts) {
    const v = velocityCheck(input.recentAutoPayouts, input.amountCents, input.nowMs ?? Date.now(), input.limits.velocity);
    if (!v.ok) throw new GuardrailError(v.code, `auto-approve refused: ${v.detail}`, v.clause);
  }
  return { path: "auto" };
}

/** Flags that always need a human, as opposed to `zip_outside_declared_area`, which P-2 turns into a question. */
export const REVIEW_FLAGS: readonly RedFlag[] = [
  "duplicate_photo_hash",
  "duplicate_address",
  "duplicate_contact",
  "amount_outlier",
  "evidence_mismatch",
  "instruction_in_narrative",
];

export type NextStatus = Extract<CaseStatus, "needs_info" | "needs_review" | "parked" | "approved">;

export interface DecideContext {
  fundsAvailable: boolean;
  /** Usable photos/documents; when given and below the minimum, an eligible case asks for a photo instead of paying. */
  usableEvidence?: number;
  /** P-10 result; false sends an otherwise auto-approvable case to a human. */
  velocityOk?: boolean;
}

/**
 * Where a freshly evaluated case goes. `ineligible` never becomes `rejected`:
 * it lands in the human queue with the agent's reasons attached.
 */
export function decideStatus(decision: Decision, amountCents: number | null, limits: AutoApproveLimits, ctx: DecideContext): {
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
  if (ctx.usableEvidence !== undefined && ctx.usableEvidence < limits.minUsableEvidence) {
    return { status: "needs_info", clause: "P-3", reason: "no usable photo or document on file" };
  }
  const auto = autoApproveCheck(decision, amountCents, limits, ctx.usableEvidence);
  if (!auto.ok) return { status: "needs_review", clause: auto.clause, reason: auto.detail };
  if (ctx.velocityOk === false) {
    return { status: "needs_review", clause: "P-10", reason: "automation limit reached; a human must approve" };
  }
  if (!ctx.fundsAvailable) return { status: "parked", clause: "P-8", reason: "fund balance too low; re-evaluated on the next donation" };
  return { status: "approved", clause: "P-9", reason: "all auto-approve conditions hold" };
}

export function limitsFromEnv(env: {
  AUTO_APPROVE_LIMIT: number;
  AUTO_APPROVE_MIN_CONFIDENCE: number;
  AUTO_APPROVE_DOUBLE_CHECK?: boolean;
}): AutoApproveLimits {
  return {
    limitCents: env.AUTO_APPROVE_LIMIT * 100,
    minConfidence: env.AUTO_APPROVE_MIN_CONFIDENCE,
    minTier: POLICY.autoApproveMinTier,
    minUsableEvidence: POLICY.autoApproveMinEvidence,
    humanMaxCents: humanMaxCents(),
    requireSecondEvaluation: env.AUTO_APPROVE_DOUBLE_CHECK ?? true,
    velocity: { ...POLICY.velocity },
  };
}
