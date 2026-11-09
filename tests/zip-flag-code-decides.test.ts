// README "What the code enforces": code, not the model, decides whether the home is inside the declared area (P-2).
// A model that adds zip_outside_declared_area to an address inside the area must not send the applicant a
// proof-of-residence question; an address outside the area gets the flag whatever the model said.
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { applyCodeRules } from "@/lib/agent/evaluate";
import { decideStatus, limitsFromEnv } from "@/lib/agent/guardrails";
import type { Decision } from "@/lib/agent/schema";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { MESSAGES } from "@/lib/i18n/messages";

const limits = limitsFromEnv(getEnv());
const c = (zip: string): CaseDoc => ({
  id: "C-1",
  token: "t".repeat(32),
  lang: "en",
  zip,
  householdSize: 3,
  requestedAmountCents: 25_000,
  narrative: "Water came into the kitchen on Tuesday night.",
  photos: ["cases/C-1/photo-1.jpg"],
  docs: [],
  contact: { name: "A", email: "a@example.test" },
  status: "evaluating",
  timestamps: { created: Timestamp.fromMillis(1_700_000_000_000) },
});
const d: Decision = {
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: 25_000,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water" }],
  redFlags: ["zip_outside_declared_area"],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded; household of 3",
};

describe("P-2 is decided in code", () => {
  it("drops a model's zip flag for an address inside the area", () => {
    const out = applyCodeRules(d, c("28501"), [], { usable: 1 });
    expect(out.redFlags).not.toContain("zip_outside_declared_area");
    expect(out.followUpQuestions).not.toContain(MESSAGES.en.proofOfResidence);
    expect(decideStatus(out, out.recommendedAmountCents, limits, { fundsAvailable: true, usableEvidence: 1, velocityOk: true }).status).toBe("approved");
  });
  it("adds the flag for an address outside the area even when the model did not", () => {
    const out = applyCodeRules({ ...d, redFlags: [] }, c("27312"), [], { usable: 1 });
    expect(out.redFlags).toContain("zip_outside_declared_area");
  });
});
