import { describe, expect, it } from "vitest";
import { GuardrailError } from "@/lib/agent/guardrails";
import { CASE_STATUSES } from "@/lib/agent/schema";
import { assertTransition, canTransition } from "@/lib/agent/transitions";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof GuardrailError ? err.code : `unexpected:${String(err)}`;
  }
}

describe("agent transitions", () => {
  it("follows the evaluation path", () => {
    expect(canTransition("agent", "new", "evaluating")).toBe(true);
    for (const to of ["needs_info", "needs_review", "parked", "approved"] as const) {
      expect(canTransition("agent", "evaluating", to)).toBe(true);
    }
    expect(canTransition("agent", "approved", "paying")).toBe(true);
    expect(canTransition("agent", "approved", "parked")).toBe(true);
    expect(canTransition("agent", "parked", "approved")).toBe(true);
  });

  it("never rejects, even as a same-status write", () => {
    expect(codeOf(() => assertTransition("agent", "needs_review", "rejected"))).toBe("agent_cannot_reject");
    expect(codeOf(() => assertTransition("agent", "rejected", "rejected"))).toBe("agent_cannot_reject");
  });

  it("cannot move paid, paying or rejected cases anywhere", () => {
    for (const from of ["paid", "paying", "rejected"] as const) {
      for (const to of CASE_STATUSES) {
        if (to === from) continue;
        expect(canTransition("agent", from, to), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it("cannot pull a case out of the human queue or regress a paid case", () => {
    expect(codeOf(() => assertTransition("agent", "needs_review", "approved"))).toBe("illegal_transition");
    expect(codeOf(() => assertTransition("agent", "paid", "needs_info"))).toBe("illegal_transition");
    expect(codeOf(() => assertTransition("agent", "needs_info", "approved"))).toBe("illegal_transition");
  });

  it("may only pay or park a human-approved case", () => {
    expect(codeOf(() => assertTransition("agent", "approved", "paying", { humanApproved: true }))).toBeUndefined();
    expect(codeOf(() => assertTransition("agent", "approved", "parked", { humanApproved: true }))).toBeUndefined();
    expect(codeOf(() => assertTransition("agent", "approved", "needs_review", { humanApproved: true }))).toBe("human_override");
    expect(codeOf(() => assertTransition("agent", "approved", "needs_review"))).toBeUndefined();
  });

  it("returns a parked human-approved case to its approval when money arrives, and nowhere else", () => {
    expect(codeOf(() => assertTransition("agent", "parked", "approved", { humanApproved: true }))).toBeUndefined();
    expect(canTransition("agent", "parked", "approved", { humanApproved: true })).toBe(true);
    expect(codeOf(() => assertTransition("agent", "parked", "needs_review", { humanApproved: true }))).toBe("human_override");
    expect(codeOf(() => assertTransition("agent", "approved", "needs_info", { humanApproved: true }))).toBe("human_override");
  });

  it("same-status writes are idempotent no-ops", () => {
    expect(codeOf(() => assertTransition("agent", "needs_info", "needs_info"))).toBeUndefined();
    expect(codeOf(() => assertTransition("agent", "paid", "paid"))).toBeUndefined();
  });
});

describe("system transitions", () => {
  it("settles and fails payouts", () => {
    expect(canTransition("system", "paying", "paid")).toBe(true);
    expect(canTransition("system", "paying", "needs_review")).toBe(true);
    expect(canTransition("system", "paying", "approved")).toBe(true);
    expect(canTransition("system", "needs_info", "new")).toBe(true);
  });
  it("does not approve or reject on its own; may only reopen a paid case when money came back", () => {
    expect(canTransition("system", "needs_review", "approved")).toBe(false);
    expect(canTransition("system", "new", "rejected")).toBe(false);
    expect(canTransition("system", "paid", "approved")).toBe(false);
    expect(canTransition("system", "paid", "needs_review")).toBe(true); // REFUNDED / REVERSED / RETURNED after SUCCESS
  });
});

describe("human transitions", () => {
  it("decides the queue and may reject or reopen", () => {
    expect(canTransition("human:ops", "needs_review", "approved")).toBe(true);
    expect(canTransition("human:ops", "needs_review", "rejected")).toBe(true);
    expect(canTransition("human:ops", "rejected", "needs_review")).toBe(true);
    expect(canTransition("human:ops", "approved", "rejected")).toBe(true);
  });
  it("cannot touch money in flight or already paid", () => {
    expect(canTransition("human:ops", "paying", "rejected")).toBe(false);
    expect(canTransition("human:ops", "paid", "approved")).toBe(false);
    expect(codeOf(() => assertTransition("human:ops", "paid", "rejected"))).toBe("illegal_transition");
  });
});
