// Structural checks on the seed data (no services): every case has its own recipient token, the bulk
// spec adds up to 12, expectations use valid statuses/flags, and tokens exist in the account template.
// Then the seed plan (lib/seed/plan.ts) that `pnpm seed` writes, and the placeholder images.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_STATUSES, RED_FLAGS } from "@/lib/agent/schema";
import { hammingDistance, imageHash, isNearDuplicate } from "@/lib/dedupe/phash";
import { buildSeedPlan, nearDuplicateImages, resetBlockers, SeedPlanError, spreadLangs, type PlannedCase } from "@/lib/seed/plan";
import { placeholderImage } from "@/lib/seed/placeholder";

const cases = JSON.parse(readFileSync(path.join(process.cwd(), "seed", "cases.json"), "utf8"));
const accounts = JSON.parse(readFileSync(path.join(process.cwd(), "seed", "accounts.example.json"), "utf8"));

describe("seed/cases.json", () => {
  it("has 10 hand-crafted cases with unique ids and unique recipient tokens", () => {
    expect(cases.cases).toHaveLength(10);
    const ids = cases.cases.map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(10);
    const emails = cases.cases.map((c: { contact: { email: string } }) => c.contact.email);
    expect(new Set(emails).size).toBe(10);
    for (const e of emails) expect(e).toMatch(/^\{\{RECIPIENT_\d+\}\}$/);
  });

  it("every recipient token and bulk token exists in accounts.example.json", () => {
    const tokens = [
      ...cases.cases.map((c: { contact: { email: string } }) => c.contact.email),
      ...cases.bulk.generate.flatMap((g: { recipientTokens: string[] }) => g.recipientTokens),
    ];
    for (const t of tokens) expect(accounts, t).toHaveProperty(t.replace(/[{}]/g, ""));
  });

  it("bulk spec: 8 tier-2 + 4 tier-3 = 12, one token per generated case", () => {
    const gen = cases.bulk.generate as Array<{ template: string; count: number; lang: Record<string, number>; recipientTokens: string[] }>;
    expect(gen.map((g) => [g.template, g.count])).toEqual([
      ["tier2_clean", 8],
      ["tier3_displaced", 4],
    ]);
    for (const g of gen) {
      expect(g.recipientTokens).toHaveLength(g.count);
      expect(Object.values(g.lang).reduce((a, b) => a + b, 0)).toBe(g.count);
    }
  });

  it("expectations use valid statuses, flags and tiers", () => {
    for (const c of cases.cases as Array<{ id: string; _expected: { status?: string; redFlags: string[]; tier: number | null; autoPaid: boolean } }>) {
      if (c._expected.status) expect(CASE_STATUSES, c.id).toContain(c._expected.status);
      for (const f of c._expected.redFlags) expect(RED_FLAGS, `${c.id} ${f}`).toContain(f);
      if (c._expected.tier !== null) expect([1, 2, 3, 4], c.id).toContain(c._expected.tier);
      if (c._expected.autoPaid) expect(c._expected.redFlags, `${c.id} auto-pays only without flags`).toEqual([]);
    }
  });

  it("C-009 reuses C-003's first photo file (duplicate detection demo)", () => {
    const byId = Object.fromEntries((cases.cases as Array<{ id: string; photos: string[] }>).map((c) => [c.id, c]));
    expect(byId["C-009"].photos).toEqual([byId["C-003"].photos[0]]);
  });

  it("the fund starts without seeded donations", () => {
    expect(cases.fund).not.toHaveProperty("_initialDonationsCents");
  });
});

/** accounts.example.json with a distinct sandbox-looking email per key (the template's xxxxx emails are refused). */
function filledAccounts(): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(accounts)
      .filter((k) => !k.startsWith("_"))
      .map((k) => [k, { email: `${k.toLowerCase()}@personal.example.com` }]),
  );
}

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof SeedPlanError) return err.problems;
    throw err;
  }
  return [];
}

describe("seed plan", () => {
  const plan = buildSeedPlan(cases, filledAccounts());
  const byId = Object.fromEntries(plan.cases.map((c) => [c.id, c])) as Record<string, PlannedCase>;
  const bulk = plan.cases.filter((c) => c.source === "bulk");

  it("creates 22 cases in first-come order: C-001..C-010, then 8 tier-2 and 4 tier-3 bulk cases", () => {
    expect(plan.cases.map((c) => c.id)).toEqual(Array.from({ length: 22 }, (_, i) => `C-${String(i + 1).padStart(3, "0")}`));
    expect(bulk.map((c) => c.template)).toEqual([...Array(8).fill("tier2_clean"), ...Array(4).fill("tier3_displaced")]);
    expect(plan.skipped).toEqual([]);
  });

  it("resolves every recipient token, BULK_01..12 in generation order", () => {
    expect(byId["C-001"].contact.email).toBe("recipient_1@personal.example.com");
    expect(bulk.map((c) => c.contact.email)).toEqual(Array.from({ length: 12 }, (_, i) => `bulk_${String(i + 1).padStart(2, "0")}@personal.example.com`));
  });

  it("keeps the expectations as metadata and drops the other underscore fields", () => {
    expect(byId["C-004"].expected).toMatchObject({ tier: 4, recommendedAmountCents: 55000 });
    expect(bulk[0].expected).toMatchObject({ tier: 2, autoPaid: true });
    for (const c of plan.cases) expect(Object.keys(c).filter((k) => k.startsWith("_"))).toEqual([]);
  });

  it("splits bulk languages per spec and interleaves them", () => {
    const tier2 = bulk.filter((c) => c.template === "tier2_clean").map((c) => c.lang);
    const tier3 = bulk.filter((c) => c.template === "tier3_displaced").map((c) => c.lang);
    expect(tier2).toEqual(["en", "en", "en", "es", "en", "en", "en", "es"]);
    expect(tier3).toEqual(["en", "en", "en", "es"]);
    for (const c of bulk.filter((x) => x.lang === "es")) expect(c.narrative).toMatch(/[áéíóúñ]|agua|casa/);
  });

  it("gives each bulk case its own pool photo, address and phone", () => {
    expect(bulk.map((c) => c.photos[0])).toEqual([
      ...Array.from({ length: 8 }, (_, i) => `photos/pool/tier2_clean-0${i + 1}.jpg`),
      ...Array.from({ length: 4 }, (_, i) => `photos/pool/tier3_displaced-0${i + 1}.jpg`),
    ]);
    expect(new Set(bulk.map((c) => c.contact.address)).size).toBe(12);
    expect(new Set(bulk.map((c) => c.contact.phone)).size).toBe(12);
  });

  it("keeps bulk households at 4 or fewer so P-6 never changes the demo arithmetic", () => {
    for (const c of bulk) expect(c.householdSize, c.id).toBeLessThanOrEqual(4);
  });

  it("shares a photo and an address only where _expected says the dedupe should fire (C-009 → C-003)", () => {
    expect(byId["C-009"].photos[0]).toBe(byId["C-003"].photos[0]);
    const tamperedCases = structuredClone(cases);
    tamperedCases.cases.find((c: { id: string }) => c.id === "C-006").photos = ["photos/C-001-kitchen-water.jpg"];
    expect(problemsOf(() => buildSeedPlan(tamperedCases, filledAccounts()))).toEqual([expect.stringMatching(/C-006 shares its photo with C-001/)]);
  });

  it("is deterministic", () => {
    expect(buildSeedPlan(cases, filledAccounts())).toEqual(plan);
  });

  it("--demo leaves out C-001 for the live scene", () => {
    const demo = buildSeedPlan(cases, filledAccounts(), { demo: true });
    expect(demo.skipped).toEqual(["C-001"]);
    expect(demo.cases).toHaveLength(21);
    expect(demo.cases[0].id).toBe("C-002");
  });

  it("refuses template, missing and shared account emails", () => {
    const acc = filledAccounts() as Record<string, { email: string }>;
    expect(problemsOf(() => buildSeedPlan(cases, accounts)).some((p) => /RECIPIENT_1 still has the template email/.test(p))).toBe(true);
    const missing = { ...acc };
    delete missing.BULK_12;
    expect(problemsOf(() => buildSeedPlan(cases, missing))).toEqual(["C-022: BULK_12 has no email in seed/accounts.json"]);
    const shared = { ...acc, RECIPIENT_6: { email: acc.RECIPIENT_1.email.toUpperCase() } };
    expect(problemsOf(() => buildSeedPlan(cases, shared))).toEqual([expect.stringMatching(/C-006 shares its email with C-001/)]);
  });

  it("refuses image paths outside seed/photos", () => {
    const bad = structuredClone(cases);
    bad.cases[0].photos = ["../service-account.json"];
    expect(problemsOf(() => buildSeedPlan(bad, filledAccounts()))[0]).toMatch(/cases\.0\.photos\.0/);
  });
});

describe("spreadLangs", () => {
  it("rejects counts that do not add up", () => {
    expect(() => spreadLangs({ en: 3, es: 2 }, 4)).toThrow(/add up/);
  });
  it("handles a single language", () => {
    expect(spreadLangs({ es: 3 }, 3)).toEqual(["es", "es", "es"]);
  });
});

describe("resetBlockers", () => {
  it("lists paying cases and pending payouts only", () => {
    expect(
      resetBlockers(
        [
          { id: "C-001", status: "paid" },
          { id: "C-002", status: "paying" },
        ],
        [
          { caseId: "C-001", outcome: "paid", status: "SUCCESS" },
          { caseId: "C-002", outcome: "pending", status: "UNCLAIMED" },
        ],
      ),
    ).toEqual(["case C-002 is paying", "payout for C-002 is pending at PayPal (UNCLAIMED)"]);
  });
});

describe("placeholder images", () => {
  it("hash apart for different files and identically for the same file", async () => {
    const plan = buildSeedPlan(cases, filledAccounts());
    const paths = [...new Set(plan.cases.flatMap((c) => [...c.photos, ...c.docs]))];
    const hashes = await Promise.all(paths.map(async (p) => imageHash(await placeholderImage(p))));
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) expect(isNearDuplicate(hashes[i], hashes[j]), `${paths[i]} vs ${paths[j]}`).toBe(false);
    }
    const again = await imageHash(await placeholderImage(paths[0]));
    expect(hammingDistance(again, hashes[0])).toBe(0);
  });

  it("nearDuplicateImages ignores two photos of the same case and reports look-alikes across cases", () => {
    const h = "0f0f0f0f0f0f0f0f";
    expect(nearDuplicateImages([{ path: "a", hash: h, caseIds: ["C-001"] }, { path: "b", hash: h, caseIds: ["C-001"] }])).toEqual([]);
    expect(nearDuplicateImages([{ path: "a", hash: h, caseIds: ["C-001"] }, { path: "b", hash: h, caseIds: ["C-002"] }])).toHaveLength(1);
  });
});
