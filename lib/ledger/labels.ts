// Public wording for the policy's tiers (policy.md §3), shared by the ledger report (a client component, so
// nothing server-only may be imported here), the landing page and /policy.

/** What each tier means to a reader, in a few words. */
export const NEED_LABEL: Record<number, string> = {
  1: "Minor loss",
  2: "Damaged home",
  3: "Displaced",
  4: "Displaced, high need",
};

/**
 * The agent's one-line summary as the public reads it: tier numbers are internal ("...destroyed. Tier 3."),
 * and the ledger already shows the level of need in words.
 */
export function publicSummary(summary: string): string {
  return summary
    .replace(/[\s,;.]*\(?\btier\s*\d\)?\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[,;]$/, ".");
}

/** One line on each tier for /policy. */
export const NEED_DETAIL: Record<number, string> = {
  1: "Spoiled food, a short power outage or other small losses.",
  2: "Real damage to the home, but the family can still live there.",
  3: "The home is unsafe to live in, so the family has had to leave.",
  4: "Displaced with children or other dependents, or with a medical need.",
};
