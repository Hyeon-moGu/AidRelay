import { describe, expect, it } from "vitest";
import {
  assertAgentStatusWrite,
  assertPayable,
  autoApproveCheck,
  decideStatus,
  GuardrailError,
  limitsFromEnv,
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
  limits,
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof GuardrailError ? err.code : `unexpected:${String(err)}`;
  }
}

describe("assertAgentStatusWrite (AGENTS.md §1.2)", () => {
  it("refuses rejected and allows everything else", () => {
    expect(codeOf(() => assertAgentStatusWrite("rejected"))).toBe("agent_cannot_reject");
    for (const s of ["new", "evaluating", "needs_info", "needs_review", "approved", "parked", "paying", "paid"] as const) {
      expect(codeOf(() => assertAgentStatusWrite(s))).toBeUndefined();
    }
  });
});

describe("autoApproveCheck — every P-9 condition", () => {
  it("passes a clean tier-2 $250 case", () => {
    expect(autoApproveCheck(eligible, 25_000, limits)).toEqual({ ok: true });
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
  });
  it("no decision at all", () => {
    expect(autoApproveCheck(undefined, 25_000, limits)).toMatchObject({ ok: false, code: "no_decision" });
  });
});

describe("assertPayable", () => {
  it("auto path when every condition holds", () => {
    expect(assertPayable(base)).toEqual({ path: "auto" });
  });
  it("human path skips P-9.1–5 but not the invariants", () => {
    const human = { ...base, humanApproved: true, aiDecision: { ...eligible, tier: 4, redFlags: ["evidence_mismatch" as const] }, amountCents: 55_000 };
    expect(assertPayable(human)).toEqual({ path: "human" });
    expect(codeOf(() => assertPayable({ ...human, fundBalanceCents: 10_000 }))).toBe("insufficient_funds");
    expect(codeOf(() => assertPayable({ ...human, existingPayout: true }))).toBe("prior_payout");
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

describe("decideStatus — the ten seed cases", () => {
  const d = (patch: Partial<Decision>): Decision => ({ ...eligible, ...patch });

  it("C-001 / C-002 / C-006: eligible tier 2 $250 → approved", () => {
    expect(decideStatus(d({}), 25_000, limits, true).status).toBe("approved");
  });
  it("C-003: tier 3 $350 → needs_review (over the auto limit)", () => {
    expect(decideStatus(d({ tier: 3 }), 35_000, limits, true)).toMatchObject({ status: "needs_review", clause: "P-9.3" });
  });
  it("C-004: tier 4 + P-6 = $550 → needs_review", () => {
    expect(decideStatus(d({ tier: 4 }), 55_000, limits, true).status).toBe("needs_review");
  });
  it("C-005: tier 2 + P-6 = $350 → needs_review", () => {
    expect(decideStatus(d({ tier: 2 }), 35_000, limits, true).status).toBe("needs_review");
  });
  it("C-007: incomplete → needs_info", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: null }), null, limits, true)).toMatchObject({ status: "needs_info", clause: "P-5" });
  });
  it("C-008: zip outside the area → needs_info (P-2), not review", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: 3, redFlags: ["zip_outside_declared_area"] }), null, limits, true)).toMatchObject({ status: "needs_info", clause: "P-2" });
  });
  it("C-009: duplicate photo + address → needs_review", () => {
    expect(decideStatus(d({ tier: 3, redFlags: ["duplicate_photo_hash", "duplicate_address"] }), 35_000, limits, true)).toMatchObject({ status: "needs_review", clause: "P-4" });
  });
  it("C-010: outlier + evidence mismatch → needs_review even though eligibility is needs_info", () => {
    expect(decideStatus(d({ eligibility: "needs_info", tier: null, redFlags: ["amount_outlier", "evidence_mismatch"] }), null, limits, true).status).toBe("needs_review");
  });
  it("ineligible never becomes rejected", () => {
    expect(decideStatus(d({ eligibility: "ineligible" }), null, limits, true).status).toBe("needs_review");
  });
  it("auto-approvable but no money → parked", () => {
    expect(decideStatus(d({}), 25_000, limits, false)).toMatchObject({ status: "parked", clause: "P-8" });
  });
});
