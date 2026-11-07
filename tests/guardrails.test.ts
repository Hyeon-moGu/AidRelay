import { describe, expect, it } from "vitest";
import {
  assertAgentStatusWrite,
  assertPayable,
  autoApproveCheck,
  decideStatus,
  GuardrailError,
  limitsFromEnv,
  velocityCheck,
  type AutoApproveLimits,
  type PayableInput,
} from "@/lib/agent/guardrails";
import type { Decision } from "@/lib/agent/schema";

const limits: AutoApproveLimits = limitsFromEnv({ AUTO_APPROVE_LIMIT: 250, AUTO_APPROVE_MIN_CONFIDENCE: 0.85 });

const eligible: Decision = {
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: 25_000,
  confidence: 0.9,
  reasons: [{ clause: "P-3", evidence: "standing water in the kitchen" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Flooded kitchen, family of 3, tier 2",
};

const base: PayableInput = {
  caseStatus: "new",
  aiDecision: eligible,
  humanApproved: false,
  amountCents: 25_000,
  fundBalanceCents: 100_000,
  caseReservedCents: 0,
  existingPayout: false,
  usableEvidenceCount: 2,
  limits,
};

const ok = { fundsAvailable: true, usableEvidence: 2, velocityOk: true };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof GuardrailError ? err.code : `unexpected:${String(err)}`;
  }
}

describe("limitsFromEnv mirrors the policy", () => {
  it("carries the P-7 ceiling, the evidence minimum and the P-10 limits", () => {
    expect(limits).toMatchObject({ limitCents: 25_000, minConfidence: 0.85, minTier: 1, minUsableEvidence: 1, humanMaxCents: 130_000 });
    expect(limits.velocity).toEqual({ maxAutoPayoutsPerHour: 20, maxAutoPaidCentsPer24h: 500_000 });
  });
});

describe("assertAgentStatusWrite (AGENTS.md §1.2)", () => {
  it("refuses rejected and allows everything else", () => {
    expect(codeOf(() => assertAgentStatusWrite("rejected"))).toBe("agent_cannot_reject");
    for (const s of ["new", "evaluating", "needs_info", "needs_review", "approved", "parked", "paying", "paid"] as const) {
      expect(codeOf(() => assertAgentStatusWrite(s))).toBeUndefined();
    }
  });
});

describe("autoApproveCheck — every P-9 decision condition", () => {
  it("passes a clean tier-2 $250 case with evidence", () => {
    expect(autoApproveCheck(eligible, 25_000, limits, 1)).toEqual({ ok: true });
  });
  it("P-9.1 eligibility", () => {
    expect(autoApproveCheck({ ...eligible, eligibility: "needs_info" }, 25_000, limits)).toMatchObject({ ok: false, code: "not_eligible" });
    expect(autoApproveCheck({ ...eligible, eligibility: "ineligible" }, 25_000, limits)).toMatchObject({ ok: false, code: "not_eligible" });
  });
  it("P-9.2 tier minimum", () => {
    expect(autoApproveCheck({ ...eligible, tier: null }, 25_000, limits)).toMatchObject({ ok: false, code: "below_min_tier" });
    expect(autoApproveCheck({ ...eligible, tier: 1 }, 10_000, { ...limits, minTier: 2 })).toMatchObject({ ok: false, code: "below_min_tier" });
  });
  it("P-9.3 amount limit", () => {
    expect(autoApproveCheck({ ...eligible, tier: 3 }, 35_000, limits)).toMatchObject({ ok: false, code: "over_auto_limit" });
    expect(autoApproveCheck(eligible, 25_001, limits)).toMatchObject({ ok: false, code: "over_auto_limit" });
  });
  it("P-9.4 confidence", () => {
    expect(autoApproveCheck({ ...eligible, confidence: 0.84 }, 25_000, limits)).toMatchObject({ ok: false, code: "low_confidence" });
    expect(autoApproveCheck({ ...eligible, confidence: 0.85 }, 25_000, limits)).toEqual({ ok: true });
  });
  it("P-9.5 red flags", () => {
    expect(autoApproveCheck({ ...eligible, redFlags: ["duplicate_photo_hash"] }, 25_000, limits)).toMatchObject({ ok: false, code: "red_flags" });
    expect(autoApproveCheck({ ...eligible, redFlags: ["instruction_in_narrative"] }, 25_000, limits)).toMatchObject({ ok: false, code: "red_flags" });
  });
  it("P-9.8 evidence on file", () => {
    expect(autoApproveCheck(eligible, 25_000, limits, 0)).toMatchObject({ ok: false, code: "no_evidence", clause: "P-9.8" });
    expect(autoApproveCheck(eligible, 25_000, limits, undefined)).toEqual({ ok: true });
  });
  it("no decision at all", () => {
    expect(autoApproveCheck(undefined, 25_000, limits)).toMatchObject({ ok: false, code: "no_decision" });
  });
});

describe("velocityCheck (P-10)", () => {
  const now = 1_000_000_000_000;
  const minutesAgo = (m: number, amountCents = 25_000) => ({ atMs: now - m * 60_000, amountCents });

  it("allows the demo burst: 11 auto payouts in a few minutes", () => {
    const recent = Array.from({ length: 10 }, (_, i) => minutesAgo(i));
    expect(velocityCheck(recent, 25_000, now, limits.velocity)).toEqual({ ok: true });
  });
  it("stops the 21st payout within an hour", () => {
    const recent = Array.from({ length: 20 }, (_, i) => minutesAgo(i * 2));
    expect(velocityCheck(recent, 25_000, now, limits.velocity)).toMatchObject({ ok: false, code: "velocity_limit", clause: "P-10" });
  });
  it("forgets payouts older than an hour for the count, but not for the 24h sum", () => {
    const tenOldOnes = Array.from({ length: 10 }, (_, i) => minutesAgo(61 + i));
    expect(velocityCheck(tenOldOnes, 25_000, now, limits.velocity)).toEqual({ ok: true });
    const fullDay = Array.from({ length: 20 }, (_, i) => minutesAgo(120 + i * 30, 25_000)); // $5,000 already paid today
    expect(velocityCheck(fullDay, 25_000, now, limits.velocity)).toMatchObject({ ok: false, code: "velocity_limit" });
  });
  it("ignores anything older than 24 hours", () => {
    const old = Array.from({ length: 30 }, (_, i) => minutesAgo(1_500 + i));
    expect(velocityCheck(old, 25_000, now, limits.velocity)).toEqual({ ok: true });
  });
});

describe("assertPayable", () => {
  it("auto path when every condition holds", () => {
    expect(assertPayable(base)).toEqual({ path: "auto" });
  });
  it("human path skips P-9.1–5 and 8 but not the invariants", () => {
    const human = { ...base, humanApproved: true, usableEvidenceCount: 0, aiDecision: { ...eligible, tier: 4, redFlags: ["evidence_mismatch" as const] }, amountCents: 55_000 };
    expect(assertPayable(human)).toEqual({ path: "human" });
    expect(codeOf(() => assertPayable({ ...human, fundBalanceCents: 10_000 }))).toBe("insufficient_funds");
    expect(codeOf(() => assertPayable({ ...human, existingPayout: true }))).toBe("prior_payout");
  });
  it("P-7 human ceiling: $1,300 passes, $1,300.01 does not", () => {
    const human = { ...base, humanApproved: true, fundBalanceCents: 1_000_000 };
    expect(assertPayable({ ...human, amountCents: 130_000 })).toEqual({ path: "human" });
    expect(codeOf(() => assertPayable({ ...human, amountCents: 130_001 }))).toBe("over_human_cap");
  });
  it("P-9.6 never overdraws, counting the case's own reservation", () => {
    expect(codeOf(() => assertPayable({ ...base, fundBalanceCents: 24_999 }))).toBe("insufficient_funds");
    expect(assertPayable({ ...base, fundBalanceCents: 0, caseReservedCents: 25_000 })).toEqual({ path: "auto" });
  });
  it("P-9.7 / §1.3 one payout per case", () => {
    expect(codeOf(() => assertPayable({ ...base, existingPayout: true }))).toBe("prior_payout");
    expect(codeOf(() => assertPayable({ ...base, caseStatus: "paying" }))).toBe("prior_payout");
    expect(codeOf(() => assertPayable({ ...base, caseStatus: "paid" }))).toBe("prior_payout");
  });
  it("P-9.8 unknown evidence counts as none on the auto path", () => {
    expect(codeOf(() => assertPayable({ ...base, usableEvidenceCount: undefined }))).toBe("no_evidence");
    expect(codeOf(() => assertPayable({ ...base, usableEvidenceCount: 0 }))).toBe("no_evidence");
  });
  it("P-10 velocity applies to the auto path only", () => {
    const now = 1_000_000_000_000;
    const burst = Array.from({ length: 20 }, (_, i) => ({ atMs: now - i * 60_000, amountCents: 25_000 }));
    expect(codeOf(() => assertPayable({ ...base, recentAutoPayouts: burst, nowMs: now }))).toBe("velocity_limit");
    expect(assertPayable({ ...base, humanApproved: true, recentAutoPayouts: burst, nowMs: now })).toEqual({ path: "human" });
  });
  it("rejected cases and bad amounts", () => {
    expect(codeOf(() => assertPayable({ ...base, caseStatus: "rejected", humanApproved: true }))).toBe("status_not_payable");
    expect(codeOf(() => assertPayable({ ...base, amountCents: 0 }))).toBe("bad_amount");
    expect(codeOf(() => assertPayable({ ...base, amountCents: 10.5 }))).toBe("bad_amount");
  });
  it("auto path refuses on each P-9 decision condition", () => {
    expect(codeOf(() => assertPayable({ ...base, aiDecision: undefined }))).toBe("no_decision");
    expect(codeOf(() => assertPayable({ ...base, amountCents: 35_000, aiDecision: { ...eligible, tier: 3 } }))).toBe("over_auto_limit");
    expect(codeOf(() => assertPayable({ ...base, aiDecision: { ...eligible, confidence: 0.5 } }))).toBe("low_confidence");
    expect(codeOf(() => assertPayable({ ...base, aiDecision: { ...eligible, redFlags: ["duplicate_address"] } }))).toBe("red_flags");
  });
});

describe("decideStatus — the ten seed cases and the hardening rules", () => {
  const d = (patch: Partial<Decision>): Decision => ({ ...eligible, ...patch });

  it("C-001 / C-002 / C-006: eligible tier 2 $250 → approved", () => {
    expect(decideStatus(d({}), 25_000, limits, ok).status).toBe("approved");
  });
  it("C-003: tier 3 $350 → needs_review (over the auto limit)", () => {
    expect(decideStatus(d({ tier: 3 }), 35_000, limits, ok)).toMatchObject({ status: "needs_review", clause: "P-9.3" });
  });
  it("C-004: tier 4 + P-6 = $550 → needs_review", () => {
    expect(decideStatus(d({ tier: 4 }), 55_000, limits, ok).status).toBe("needs_review");
  });
  it("C-005: tier 2 + P-6 = $350 → needs_review", () => {
    expect(decideStatus(d({ tier: 2 }), 35_000, limits, ok).status).toBe("needs_review");
  });
  it("C-007: incomplete → needs_info", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: null }), null, limits, ok)).toMatchObject({ status: "needs_info", clause: "P-5" });
  });
  it("C-008: zip outside the area → needs_info (P-2), not review", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: 3, redFlags: ["zip_outside_declared_area"] }), null, limits, ok)).toMatchObject({ status: "needs_info", clause: "P-2" });
  });
  it("C-009: duplicate photo + address → needs_review", () => {
    expect(decideStatus(d({ tier: 3, redFlags: ["duplicate_photo_hash", "duplicate_address"] }), 35_000, limits, ok)).toMatchObject({ status: "needs_review", clause: "P-4" });
  });
  it("C-010: outlier + evidence mismatch → needs_review even though eligibility is needs_info", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: null, redFlags: ["amount_outlier", "evidence_mismatch"] }), null, limits, ok).status).toBe("needs_review");
  });
  it("ineligible never becomes rejected", () => {
    expect(decideStatus(d({ eligibility: "ineligible" }), null, limits, ok).status).toBe("needs_review");
  });
  it("auto-approvable but no money → parked", () => {
    expect(decideStatus(d({}), 25_000, limits, { ...ok, fundsAvailable: false })).toMatchObject({ status: "parked", clause: "P-8" });
  });
  it("P-3 / P-9.8: eligible without a usable photo asks for one instead of paying", () => {
    expect(decideStatus(d({}), 25_000, limits, { ...ok, usableEvidence: 0 })).toMatchObject({ status: "needs_info", clause: "P-3" });
  });
  it("P-10: automation limit reached → human queue", () => {
    expect(decideStatus(d({}), 25_000, limits, { ...ok, velocityOk: false })).toMatchObject({ status: "needs_review", clause: "P-10" });
  });
  it("prompt injection flag → human queue", () => {
    expect(decideStatus(d({ redFlags: ["instruction_in_narrative"] }), 25_000, limits, ok).status).toBe("needs_review");
  });
});
