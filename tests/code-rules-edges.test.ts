// Edge cases of the deterministic layer (applyCodeRules → decideStatus) and of the public text it produces.
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { applyCodeRules, normalizeDecision } from "@/lib/agent/evaluate";
import { decideStatus, limitsFromEnv } from "@/lib/agent/guardrails";
import type { Decision } from "@/lib/agent/schema";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { MESSAGES } from "@/lib/i18n/messages";
import { scrubPii } from "@/lib/ledger/anonymize";

const limits = limitsFromEnv(getEnv());

function caseDoc(patch: Partial<CaseDoc> = {}): CaseDoc {
  return {
    id: "C-1",
    token: "t".repeat(32),
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 25_000,
    narrative: "Water came into the kitchen on Tuesday night.",
    photos: ["cases/C-1/photo-1.jpg"],
    docs: [],
    contact: { name: "Dana Whitfield", email: "dana@example.test", address: "412 Mill Creek Road, Cedar Falls" },
    status: "evaluating",
    timestamps: { created: Timestamp.fromMillis(1_700_000_000_000) },
    ...patch,
  };
}

const decision = (patch: Partial<Decision> = {}): Decision => ({
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: null,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded; household of 3",
  ...patch,
});

describe("P-2 for a case the model calls ineligible", () => {
  it("an address outside the area never sends the applicant an empty follow-up", () => {
    const c = caseDoc({ zip: "27312" });
    const d = applyCodeRules(decision({ eligibility: "ineligible", tier: null }), c, [], { usable: 1 });
    const next = decideStatus(d, d.recommendedAmountCents, limits, { fundsAvailable: true, usableEvidence: 1, applicantAnswered: false });
    // P-2: outside the area → needs_info AND ask for proof of residence. Asking nothing is neither.
    if (next.status === "needs_info") expect(d.followUpQuestions).toContain(MESSAGES.en.proofOfResidence);
    else expect(next.status).toBe("needs_review");
  });
});

describe("the public line never carries part of the applicant's name", () => {
  it("scrubs the surname even when the 140-character cut falls inside it", () => {
    const prefix = "Ground floor flooded about 30 cm, furniture, food and the washer lost, home still habitable, household of three; grant paid to";
    const raw = `${prefix.padEnd(133, " ")} Whitfield family`;
    expect(raw.length).toBeGreaterThan(140);
    const d = applyCodeRules(normalizeDecision(decision({ ledgerSummary: raw })), caseDoc(), [], { usable: 1 });
    expect(d.ledgerSummary).not.toMatch(/Whitf/i);
  });
});

describe("scrubPii", () => {
  it("leaves dates alone (a date is not a phone number)", () => {
    expect(scrubPii("Flooded on 2026-11-01, two days after the storm")).toContain("2026-11-01");
  });
  it("redacts a seven-digit local phone number written without separators", () => {
    expect(scrubPii("call me at 5551234 after six")).not.toContain("5551234");
  });
});
