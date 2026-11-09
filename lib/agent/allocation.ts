// P-8: when money is short, pay by tier descending, then first-come within a tier.
// Strict priority: the walk stops at the first case the balance cannot cover, so a
// high-need case is never starved by smaller ones behind it. Pure; tested against the demo arithmetic.

export interface AllocationCase {
  id: string;
  tier: number;
  amountCents: number;
  /** Application time, ms since epoch (first-come order inside a tier). */
  createdAtMs: number;
}

export interface AllocationPlan<T extends AllocationCase> {
  pay: T[];
  park: T[];
  remainingCents: number;
}

export function sortByPolicy<T extends AllocationCase>(cases: readonly T[]): T[] {
  return [...cases].sort((a, b) => b.tier - a.tier || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
}

/**
 * P-8 for a case that is not in the queue yet: would the plan pay it if it joined the waiting cases now?
 * A new application may not take money that a waiting case ahead of it (higher tier, or the same tier
 * and earlier) still needs; one that outranks the queue is paid first, as the policy says.
 */
export function wouldBePaid(candidate: AllocationCase, waiting: readonly AllocationCase[], balanceCents: number): boolean {
  const queue = [...waiting.filter((w) => w.id !== candidate.id), candidate];
  return planAllocation(queue, balanceCents).pay.some((p) => p.id === candidate.id);
}

export function planAllocation<T extends AllocationCase>(cases: readonly T[], balanceCents: number): AllocationPlan<T> {
  const ordered = sortByPolicy(cases);
  const pay: T[] = [];
  const park: T[] = [];
  let remaining = balanceCents;
  let blocked = false;
  for (const c of ordered) {
    if (!blocked && c.amountCents <= remaining) {
      pay.push(c);
      remaining -= c.amountCents;
    } else {
      blocked = true;
      park.push(c);
    }
  }
  return { pay, park, remainingCents: remaining };
}
