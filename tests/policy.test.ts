import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  humanMaxCents,
  isAmountOutlier,
  isInsideDeclaredArea,
  maxGrantCents,
  maxRecommendedCents,
  POLICY,
} from "@/lib/agent/policy";

const policyMd = readFileSync(path.join(process.cwd(), "policy.md"), "utf8");

describe("policy.md and lib/agent/policy.ts agree", () => {
  it("tier amounts match the §3 table", () => {
    for (const [tier, cents] of Object.entries(POLICY.tierCents)) {
      const dollars = (cents / 100).toFixed(0);
      const row = new RegExp(`^\\|\\s*${tier}\\s*\\|[^|]*\\|\\s*\\$${dollars}\\s*\\|`, "m");
      expect(policyMd, `tier ${tier} should be $${dollars}`).toMatch(row);
    }
  });

  it("household adjustment matches P-6", () => {
    const per = POLICY.household.perMemberCents / 100;
    const max = POLICY.household.maxCents / 100;
    expect(policyMd).toMatch(
      new RegExp(`\\+\\$${per} per household member beyond ${POLICY.household.beyond}, max \\+\\$${max}`),
    );
  });

  it("auto-approve tier minimum matches P-9.2", () => {
    expect(policyMd).toMatch(new RegExp(`2\\. tier ≥ ${POLICY.autoApproveMinTier}`));
  });

  it("declared area prefix and event match P-1/P-2", () => {
    expect(policyMd).toContain(`zip codes beginning \`${POLICY.areaZipPrefix}\``);
    expect(policyMd).toContain(POLICY.event.name);
    expect(policyMd).toContain(POLICY.event.declaredOn);
  });

  it("policy version matches", () => {
    expect(policyMd).toMatch(new RegExp(`^# Relief Fund Policy ${POLICY.version}`, "m"));
  });

  it("P-7 human ceiling matches humanMaxCents", () => {
    const dollars = (humanMaxCents() / 100).toLocaleString("en-US");
    expect(policyMd).toContain(`up to **${POLICY.humanCapMultiplier}×** the largest possible grant (**$${dollars}**`);
  });

  it("P-9 lists the evidence, second-evaluation and automation-limit conditions", () => {
    expect(policyMd).toMatch(/8\. at least one usable photo or document/);
    expect(policyMd).toMatch(/9\. a second, separate evaluation/);
    expect(policyMd).toMatch(/10\. the automation limits in P-10/);
  });

  it("P-10 numbers match POLICY.velocity", () => {
    const perDay = (POLICY.velocity.maxAutoPaidCentsPer24h / 100).toLocaleString("en-US");
    expect(policyMd).toContain(`at most **${POLICY.velocity.maxAutoPayoutsPerHour}** grants per rolling hour`);
    expect(policyMd).toContain(`at most **$${perDay}** per rolling 24 hours`);
  });
});

describe("maxRecommendedCents (P-6, P-7) on the seed cases", () => {
  it("C-004: tier 4, household 5 → $550", () => {
    expect(maxRecommendedCents(4, 5)).toBe(55_000);
  });
  it("C-005: tier 2, household 6 → $350", () => {
    expect(maxRecommendedCents(2, 6)).toBe(35_000);
  });
  it("C-003: tier 3, household 4 → $350 (no adjustment)", () => {
    expect(maxRecommendedCents(3, 4)).toBe(35_000);
  });
  it("caps the adjustment at +$150", () => {
    expect(maxRecommendedCents(2, 12)).toBe(40_000);
  });
  it("treats an unknown household size as no adjustment", () => {
    expect(maxRecommendedCents(1, null)).toBe(10_000);
  });
});

describe("flags", () => {
  it("amount outlier: C-010 asks $2,500, C-004 asks $600", () => {
    expect(maxGrantCents()).toBe(65_000);
    expect(isAmountOutlier(250_000)).toBe(true);
    expect(isAmountOutlier(60_000)).toBe(false);
    expect(isAmountOutlier(null)).toBe(false);
  });
  it("declared area: 285xx inside, 27312 outside", () => {
    expect(isInsideDeclaredArea("28501")).toBe(true);
    expect(isInsideDeclaredArea("27312")).toBe(false);
  });
});
