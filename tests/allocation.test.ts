import { describe, expect, it } from "vitest";
import { planAllocation, sortByPolicy } from "@/lib/agent/allocation";

const c = (id: string, tier: number, amountCents: number, createdAtMs: number) => ({ id, tier, amountCents, createdAtMs });

describe("sortByPolicy (P-8)", () => {
  it("orders by tier descending, then first-come", () => {
    const ordered = sortByPolicy([c("a", 2, 25_000, 3), c("b", 3, 35_000, 2), c("c", 3, 35_000, 1), c("d", 4, 55_000, 9)]);
    expect(ordered.map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("planAllocation", () => {
  it("replays the demo: $1,750 after C-001, six-row batch → four paid, two parked", () => {
    const batch = [
      c("C-004", 4, 55_000, 4),
      c("C-003", 3, 35_000, 3),
      c("B-09", 3, 35_000, 10),
      c("B-10", 3, 35_000, 11),
      c("B-11", 3, 35_000, 12),
      c("B-12", 3, 35_000, 13),
    ];
    const plan = planAllocation(batch, 175_000);
    expect(plan.pay.map((x) => x.id)).toEqual(["C-004", "C-003", "B-09", "B-10"]);
    expect(plan.park.map((x) => x.id)).toEqual(["B-11", "B-12"]);
    expect(plan.remainingCents).toBe(15_000);
  });

  it("replays the demo: a $700 donation then pays exactly the two parked cases", () => {
    const parked = [c("B-11", 3, 35_000, 12), c("B-12", 3, 35_000, 13)];
    const plan = planAllocation(parked, 15_000 + 70_000);
    expect(plan.pay.map((x) => x.id)).toEqual(["B-11", "B-12"]);
    expect(plan.park).toEqual([]);
    expect(plan.remainingCents).toBe(15_000);
  });

  it("strict priority: a big high-tier case that does not fit blocks smaller ones behind it", () => {
    const plan = planAllocation([c("big", 4, 55_000, 1), c("small", 2, 25_000, 2)], 30_000);
    expect(plan.pay).toEqual([]);
    expect(plan.park.map((x) => x.id)).toEqual(["big", "small"]);
  });

  it("handles an empty queue and a zero balance", () => {
    expect(planAllocation([], 100)).toEqual({ pay: [], park: [], remainingCents: 100 });
    expect(planAllocation([c("x", 1, 10_000, 1)], 0).park.map((x) => x.id)).toEqual(["x"]);
  });
});
