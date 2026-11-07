import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { applyCodeRules, findDuplicates, scrubSummary } from "@/lib/agent/evaluate";
import type { Decision } from "@/lib/agent/schema";
import type { CaseDoc } from "@/lib/db/types";
import { MESSAGES } from "@/lib/i18n/messages";

function mkCase(p: Partial<CaseDoc> & { id: string }): CaseDoc {
  return {
    token: "t",
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 25_000,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "Applicant", email: `${p.id.toLowerCase()}@example.test`, phone: null, address: null },
    status: "new",
    timestamps: { created: Timestamp.now() },
    ...p,
  };
}

const eligible: Decision = {
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: 30_000,
  confidence: 0.9,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Flooded kitchen, family of 3, tier 2",
};

describe("applyCodeRules", () => {
  it("sets the amount from tier + P-6 and ignores the model's figure (C-002, C-004, C-005)", () => {
    expect(applyCodeRules(eligible, mkCase({ id: "C-002", householdSize: 4, requestedAmountCents: 30_000 }), []).recommendedAmountCents).toBe(25_000);
    expect(applyCodeRules({ ...eligible, tier: 4 }, mkCase({ id: "C-004", householdSize: 5 }), []).recommendedAmountCents).toBe(55_000);
    expect(applyCodeRules({ ...eligible, tier: 2 }, mkCase({ id: "C-005", householdSize: 6 }), []).recommendedAmountCents).toBe(35_000);
  });

  it("C-008: zip outside the area → needs_info with a Spanish proof-of-residence question", () => {
    const out = applyCodeRules(
      { ...eligible, tier: 3, applicantLanguage: "es" },
      mkCase({ id: "C-008", zip: "27312", lang: "es" }),
      [],
    );
    expect(out.eligibility).toBe("needs_info");
    expect(out.redFlags).toContain("zip_outside_declared_area");
    expect(out.followUpQuestions).toContain(MESSAGES.es.proofOfResidence);
    expect(out.recommendedAmountCents).toBeNull();
    expect(out.tier).toBe(3);
  });

  it("C-009: duplicate matches from the system become red flags", () => {
    const out = applyCodeRules({ ...eligible, tier: 3 }, mkCase({ id: "C-009", householdSize: 4 }), [
      { caseId: "C-003", by: ["photo", "address"], photoDistance: 0 },
    ]);
    expect(out.redFlags).toEqual(expect.arrayContaining(["duplicate_photo_hash", "duplicate_address"]));
    expect(out.redFlags).not.toContain("duplicate_contact");
  });

  it("C-010: amount outlier is flagged and a non-eligible case gets no amount; model flags are kept", () => {
    const out = applyCodeRules(
      { ...eligible, eligibility: "needs_info", tier: null, redFlags: ["evidence_mismatch"] },
      mkCase({ id: "C-010", householdSize: 1, requestedAmountCents: 250_000 }),
      [],
    );
    expect(out.redFlags).toEqual(expect.arrayContaining(["amount_outlier", "evidence_mismatch"]));
    expect(out.recommendedAmountCents).toBeNull();
  });

  it("scrubs contact-looking text out of the ledger summary", () => {
    const out = applyCodeRules({ ...eligible, ledgerSummary: "Call 828-555-0101 or dana@example.com, tier 2" }, mkCase({ id: "C-001" }), []);
    expect(out.ledgerSummary).not.toMatch(/828|example\.com/);
  });
});

describe("scrubSummary", () => {
  it("redacts emails and phone numbers and caps at 140 chars", () => {
    expect(scrubSummary("mail a.b@c.io now")).toBe("mail [redacted] now");
    expect(scrubSummary("tel +1 (828) 555-0101 ok")).toBe("tel [redacted] ok");
    expect(scrubSummary("x".repeat(200))).toHaveLength(140);
  });
});

describe("findDuplicates (P-4)", () => {
  const c003 = mkCase({ id: "C-003", photoHashes: ["00ff00ff00ff00ff"], contact: { name: "T", email: "r3@example.test", phone: "+1-828-555-0103", address: "1180 Low Gap Rd, Cedar Falls" } });
  const c009 = mkCase({ id: "C-009", photoHashes: ["00ff00ff00ff00fe"], contact: { name: "T", email: "r9@example.test", phone: "+1-828-555-0109", address: "1180 Low Gap Road, Cedar Falls" } });
  const c001 = mkCase({ id: "C-001", photoHashes: ["ff00ff00ff00ff00"], contact: { name: "D", email: "r1@example.test", phone: "+1-828-555-0101", address: "412 Mill Creek Rd, Cedar Falls" } });

  it("flags C-009 against C-003 by photo and address, not contact", () => {
    expect(findDuplicates(c009, [c001, c003, c009])).toEqual([{ caseId: "C-003", by: ["photo", "address"], photoDistance: 0 }]);
  });

  it("leaves distinct households alone", () => {
    expect(findDuplicates(c001, [c001, c003, c009])).toEqual([]);
  });

  it("matches a reused phone number as a contact duplicate", () => {
    const again = mkCase({ id: "C-011", contact: { name: "X", email: "x@example.test", phone: "(828) 555-0101", address: "9 Orchard Ave" } });
    expect(findDuplicates(again, [c001, again])).toEqual([{ caseId: "C-001", by: ["contact"], photoDistance: undefined }]);
  });
});
