// Structural checks on the seed data (no services): every case has its own recipient token, the bulk
// spec adds up to 12, expectations use valid statuses/flags, and tokens exist in the account template.
// Day 4 adds a live assertion of agent:sweep results against `_expected` (needs sandbox credentials).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_STATUSES, RED_FLAGS } from "@/lib/agent/schema";

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
