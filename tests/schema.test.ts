import { describe, expect, it } from "vitest";
import { AGENT_WRITABLE_STATUSES, DecisionSchema } from "@/lib/agent/schema";

const conceptExample = {
  eligibility: "eligible",
  tier: 3,
  recommendedAmountCents: 35000,
  confidence: 0.82,
  reasons: [{ clause: "P-3", evidence: "Photo 2: standing water at ground-floor door" }],
  redFlags: ["duplicate_photo_hash", "zip_outside_declared_area"],
  followUpQuestions: ["¿Cuántas personas viven en el hogar?"],
  applicantLanguage: "es",
  ledgerSummary: "Flooded ground floor, family of 4, tier 3",
};

describe("DecisionSchema", () => {
  it("accepts the docs/CONCEPT.md §6 example", () => {
    expect(DecisionSchema.parse(conceptExample)).toEqual(conceptExample);
  });

  it("rejects snake_case field names (one naming convention end to end)", () => {
    const snake: Record<string, unknown> = { ...conceptExample, recommended_amount_cents: 35000 };
    delete snake.recommendedAmountCents;
    expect(DecisionSchema.safeParse(snake).success).toBe(false);
  });

  it("rejects unknown red flags (an enum the provider does send to the model)", () => {
    expect(DecisionSchema.safeParse({ ...conceptExample, redFlags: ["looks_odd"] }).success).toBe(false);
  });

  it("is permissive on formats the provider strips (sub-clause ids, long summaries, out-of-range confidence)", () => {
    expect(
      DecisionSchema.safeParse({ ...conceptExample, reasons: [{ clause: "P-9.3", evidence: "x" }], ledgerSummary: "x".repeat(200), confidence: 1.4 }).success,
    ).toBe(true);
  });
});

describe("AGENT_WRITABLE_STATUSES", () => {
  it("never includes rejected (AGENTS.md §1.2)", () => {
    expect(AGENT_WRITABLE_STATUSES).not.toContain("rejected");
    expect(AGENT_WRITABLE_STATUSES).toContain("needs_review");
  });
});
