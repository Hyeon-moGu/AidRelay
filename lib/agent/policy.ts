// The human-written policy (docs/policy.md) is read by the model on every decision.
// The numbers the CODE enforces are mirrored here; tests/policy.test.ts fails if the two drift apart.
import { readFile } from "node:fs/promises";
import path from "node:path";

export type Tier = 1 | 2 | 3 | 4;

export const POLICY = {
  version: "v1",
  event: { name: "Cedar County Flood", declaredOn: "2026-11-01" },
  /** P-2: primary residence zip must start with this prefix. */
  areaZipPrefix: "285",
  /** §3 tier table, in cents. */
  tierCents: { 1: 10_000, 2: 25_000, 3: 35_000, 4: 50_000 } as Record<Tier, number>,
  /** P-6: +$50 per household member beyond 4, max +$150. */
  household: { beyond: 4, perMemberCents: 5_000, maxCents: 15_000 },
  /** P-8 */
  allocation: "tier-desc-then-first-come" as const,
  /** P-9.2 */
  autoApproveMinTier: 1 as Tier,
  /** P-9.8 / P-3: usable photos or documents required before the agent may pay on its own. */
  autoApproveMinEvidence: 1,
  /** P-7: a human may set at most this multiple of the largest possible grant. */
  humanCapMultiplier: 2,
  /** P-10: automation limits without a human. */
  velocity: { maxAutoPayoutsPerHour: 20, maxAutoPaidCentsPer24h: 500_000 },
  /** A request this far above the largest possible grant is flagged `amount_outlier` for a human. */
  amountOutlierMultiplier: 2,
} as const;

export function isTier(n: unknown): n is Tier {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

/** P-6 + P-7: the most the agent may recommend for a tier and household size. */
export function maxRecommendedCents(tier: Tier, householdSize: number | null): number {
  const extraMembers = Math.max(0, (householdSize ?? 0) - POLICY.household.beyond);
  const adjustment = Math.min(extraMembers * POLICY.household.perMemberCents, POLICY.household.maxCents);
  return POLICY.tierCents[tier] + adjustment;
}

/** Largest grant the policy can ever produce (tier 4 + full household adjustment). */
export function maxGrantCents(): number {
  return POLICY.tierCents[4] + POLICY.household.maxCents;
}

/** P-7: ceiling for an amount set by a human. */
export function humanMaxCents(): number {
  return maxGrantCents() * POLICY.humanCapMultiplier;
}

export function isAmountOutlier(requestedCents: number | null): boolean {
  return requestedCents !== null && requestedCents > maxGrantCents() * POLICY.amountOutlierMultiplier;
}

export function isInsideDeclaredArea(zip: string): boolean {
  return zip.replace(/\D/g, "").startsWith(POLICY.areaZipPrefix);
}

let policyTextCache: string | undefined;

/** Raw markdown of docs/policy.md, cached for the process lifetime (prompt-cached at the model too). */
export async function loadPolicyText(): Promise<string> {
  if (!policyTextCache) {
    policyTextCache = await readFile(path.join(process.cwd(), "docs", "policy.md"), "utf8");
  }
  return policyTextCache;
}
