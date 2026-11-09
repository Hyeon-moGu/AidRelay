// AGENTS.md §8, the human side of the money: a volunteer's rejection gives the reservation back to the fund, an
// approval without any amount on file is refused instead of creating a case nobody can pay, and the console
// refuses an amount above the P-7 ceiling before it is ever recorded.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});

import { humanMaxCents } from "@/lib/agent/policy";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund, reserveFunds } from "@/lib/db/repos/fund";
import type { CaseDoc } from "@/lib/db/types";
import { applyHumanDecision } from "@/lib/ops/decide";

let db: FakeFirestore;

async function seedCase(id: string, patch: Partial<CaseDoc> = {}): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: null,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
  });
  await db.collection("cases").doc(id).update({ status: "needs_review", ...patch } as Record<string, unknown>);
}

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(enqueueAgentRun).mockClear();
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents: 100_000 });
});

describe("a volunteer's decision and the fund", () => {
  it("rejecting an approved, reserved case gives the reservation back", async () => {
    await seedCase("C-A", { status: "approved", tier: 3, approvedAmountCents: 35_000 });
    await reserveFunds("C-A", 35_000, { actor: "agent", policyClause: "P-9.6", reason: "test" });
    expect((await getFund()).reservedCents).toBe(35_000);

    const { results } = await applyHumanDecision({ action: "reject", caseIds: ["C-A"], note: "not in the area" });

    expect(results[0]).toMatchObject({ ok: true, status: "rejected" });
    expect((await getFund()).reservedCents, "the fund's reservation").toBe(0);
    expect((await getCase("C-A"))?.reservedCents ?? 0, "the case's reservation").toBe(0);
  });

  it("rejecting a parked, reserved case gives the reservation back too", async () => {
    await seedCase("C-P", { status: "approved", tier: 2, approvedAmountCents: 25_000 });
    await reserveFunds("C-P", 25_000, { actor: "agent", policyClause: "P-9.6", reason: "test" });
    await db.collection("cases").doc("C-P").update({ status: "parked" });

    await applyHumanDecision({ action: "reject", caseIds: ["C-P"] });

    expect((await getFund()).reservedCents).toBe(0);
  });

  it("refuses an approval when neither the agent nor the volunteer gave an amount, and wakes no agent", async () => {
    await seedCase("C-N", { status: "needs_info" });

    const { results, agentTriggered } = await applyHumanDecision({ action: "approve", caseIds: ["C-N"] });

    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/amount/);
    expect((await getCase("C-N"))?.status).toBe("needs_info");
    expect(agentTriggered).toBe(false);
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("refuses an amount above the P-7 ceiling and records no approval", async () => {
    await seedCase("C-X", { tier: 4, approvedAmountCents: 50_000 });

    const { results } = await applyHumanDecision({ action: "approve", caseIds: ["C-X"], amounts: { "C-X": humanMaxCents() + 1 } });

    expect(results[0].ok).toBe(false);
    const c = await getCase("C-X");
    expect(c?.status).toBe("needs_review");
    expect(c?.humanDecision).toBeUndefined();
  });

  it("accepts exactly the P-7 ceiling", async () => {
    await seedCase("C-Y", { tier: 4, approvedAmountCents: 50_000 });
    const { results } = await applyHumanDecision({ action: "approve", caseIds: ["C-Y"], amounts: { "C-Y": humanMaxCents() } });
    expect(results[0]).toMatchObject({ ok: true, status: "approved", amountCents: humanMaxCents() });
  });
});
