// Regression guards: the state machine's invariants over every actor × status × status, and the
// auto-approve knobs in policy.md against the defaults in lib/env.ts and .env.example.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/agent/transitions";
import { CASE_STATUSES, type CaseStatus } from "@/lib/agent/schema";

const ACTORS = ["agent", "system", "human:ops"] as const;
const pairs = CASE_STATUSES.flatMap((from) => CASE_STATUSES.filter((to) => to !== from).map((to) => [from, to] as [CaseStatus, CaseStatus]));

describe("state machine invariants (AGENTS.md §1 rules 2 and 7), every pair", () => {
  it("the agent reaches rejected from nowhere, with or without a human approval", () => {
    for (const from of CASE_STATUSES) for (const ha of [false, true]) expect(canTransition("agent", from, "rejected", { humanApproved: ha }), from).toBe(false);
  });
  it("the agent never takes a case out of the human queue or moves money in flight or paid", () => {
    for (const [from, to] of pairs) {
      if (["needs_info", "needs_review", "paying", "paid", "rejected"].includes(from)) expect(canTransition("agent", from, to), `${from}→${to}`).toBe(false);
    }
  });
  it("with a human approval the agent may only pay, park, or return a parked case to approved", () => {
    for (const [from, to] of pairs) {
      const allowed = canTransition("agent", from, to, { humanApproved: true });
      if (allowed) expect(to === "paying" || to === "parked" || (from === "parked" && to === "approved"), `${from}→${to}`).toBe(true);
    }
  });
  it("only the system settles money: nobody else moves a case into or out of paying, or into paid", () => {
    for (const actor of ["agent", "human:ops"] as const) {
      for (const [from, to] of pairs) {
        if (to === "paid" || from === "paying" || from === "paid") expect(canTransition(actor, from, to), `${actor} ${from}→${to}`).toBe(false);
      }
    }
    for (const [from, to] of pairs) if (to === "paying") expect(canTransition("human:ops", from, to), `human ${from}→paying`).toBe(false);
  });
  it("only a human rejects", () => {
    for (const actor of ACTORS) for (const from of CASE_STATUSES) if (from !== "rejected" && canTransition(actor, from, "rejected")) expect(actor).toBe("human:ops");
  });
});

describe("P-9.3 and P-9.4 in policy.md match the shipped defaults", () => {
  const policyMd = readFileSync(path.join(process.cwd(), "policy.md"), "utf8");
  const envExample = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const envTs = readFileSync(path.join(process.cwd(), "lib", "env.ts"), "utf8");
  const exampleValue = (key: string) => new RegExp(`^${key}=([^\\s#]+)`, "m").exec(envExample)?.[1];

  it("auto-approve limit: $250", () => {
    const dollars = /recommended amount ≤ \*\*\$(\d+)\*\* \(`AUTO_APPROVE_LIMIT`\)/.exec(policyMd)?.[1];
    expect(dollars).toBeDefined();
    expect(exampleValue("AUTO_APPROVE_LIMIT")).toBe(dollars);
    expect(envTs).toMatch(new RegExp(`AUTO_APPROVE_LIMIT: z\\.coerce\\.number\\(\\)\\.int\\(\\)\\.positive\\(\\)\\.default\\(${dollars}\\)`));
    expect(process.env.AUTO_APPROVE_LIMIT).toBe(dollars);
  });
  it("minimum confidence: 0.85", () => {
    const conf = /confidence ≥ \*\*([\d.]+)\*\*/.exec(policyMd)?.[1];
    expect(conf).toBeDefined();
    expect(exampleValue("AUTO_APPROVE_MIN_CONFIDENCE")).toBe(conf);
    expect(envTs).toContain(`.default(${conf})`);
    expect(process.env.AUTO_APPROVE_MIN_CONFIDENCE).toBe(conf);
  });
});

import { planAllocation, sortByPolicy, wouldBePaid } from "@/lib/agent/allocation";

describe("planAllocation properties (P-8), 2,000 random queues", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }
  it("never spends more than the balance, pays a prefix of the policy order, and parks the rest", () => {
    const r = rng(7);
    for (let n = 0; n < 2_000; n++) {
      const cases = Array.from({ length: Math.floor(r() * 8) }, (_, i) => ({
        id: `C-${String(i).padStart(3, "0")}`,
        tier: 1 + Math.floor(r() * 4),
        amountCents: [10_000, 25_000, 35_000, 50_000][Math.floor(r() * 4)],
        createdAtMs: Math.floor(r() * 5), // many ties on purpose
      }));
      const balance = Math.floor(r() * 4) === 0 ? cases.reduce((s, c) => s + c.amountCents, 0) : Math.floor(r() * 150_000);
      const plan = planAllocation(cases, balance);
      const spent = plan.pay.reduce((s, c) => s + c.amountCents, 0);
      expect(spent).toBeLessThanOrEqual(balance);
      expect(plan.remainingCents).toBe(balance - spent);
      expect([...plan.pay, ...plan.park].map((c) => c.id)).toEqual(sortByPolicy(cases).map((c) => c.id));
      if (plan.park.length) expect(plan.park[0].amountCents).toBeGreaterThan(plan.remainingCents);
      // A balance that covers everything pays everything, including a balance exactly equal to the total.
      if (balance >= cases.reduce((s, c) => s + c.amountCents, 0)) expect(plan.park).toEqual([]);
    }
  });
  it("a balance exactly equal to one grant pays it; zero pays nothing", () => {
    const c = { id: "C-1", tier: 2, amountCents: 25_000, createdAtMs: 1 };
    expect(planAllocation([c], 25_000).pay).toEqual([c]);
    expect(planAllocation([c], 24_999).park).toEqual([c]);
    expect(planAllocation([c], 0).pay).toEqual([]);
    expect(wouldBePaid(c, [], 25_000)).toBe(true);
  });
});
