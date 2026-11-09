// Operator decisions against the in-memory Firestore fake: what a reopen or a question takes back, and
// that a refused decision leaves the money where it was.
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

import { enqueueAgentRun } from "@/lib/agent/trigger";
import { createCase, getCase, setCaseStatus } from "@/lib/db/repos/cases";
import { getFund, reserveFunds } from "@/lib/db/repos/fund";
import { amountForCase, type CaseDoc } from "@/lib/db/types";
import { applyHumanDecision } from "@/lib/ops/decide";

let db: FakeFirestore;

async function seedCase(id: string, patch: Partial<CaseDoc> = {}): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 35_000,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
  });
  await db.collection("cases").doc(id).update({ status: "needs_review", tier: 3, approvedAmountCents: 35_000, ...patch } as Record<string, unknown>);
}

const stored = (id: string) => db.read("cases", id) as Record<string, unknown>;

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(enqueueAgentRun).mockClear();
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents: 100_000 });
});

describe("applyHumanDecision", () => {
  it("approve records the volunteer's decision and wakes the agent once for the batch", async () => {
    await seedCase("C-A");
    await seedCase("C-B");
    const { results, agentTriggered } = await applyHumanDecision({ action: "approve", caseIds: ["C-A", "C-B"], amounts: { "C-B": 40_000 } });
    expect(results.map((r) => [r.caseId, r.ok, r.amountCents])).toEqual([
      ["C-A", true, 35_000],
      ["C-B", true, 40_000],
    ]);
    expect(agentTriggered).toBe(true);
    expect(enqueueAgentRun).toHaveBeenCalledTimes(1);
    expect((stored("C-A").humanDecision as { approved: boolean }).approved).toBe(true);
  });

  it("reopen takes the approval back, so the agent is no longer bound by it", async () => {
    await seedCase("C-A");
    await applyHumanDecision({ action: "approve", caseIds: ["C-A"] });
    await setCaseStatus("C-A", "parked", { actor: "agent", action: "case.parked", reason: "insufficient funds", policyClause: "P-8" });

    const { results } = await applyHumanDecision({ action: "reopen", caseIds: ["C-A"] });
    expect(results[0]).toMatchObject({ ok: true, status: "needs_review" });
    expect(stored("C-A")).not.toHaveProperty("humanDecision");

    // The path that used to loop: asked for information, the applicant answered, the agent evaluates again.
    await db.collection("cases").doc("C-A").update({ status: "evaluating" });
    const evaluated = await setCaseStatus("C-A", "needs_review", { actor: "agent", action: "case.evaluated", reason: "red flags", policyClause: "P-4" });
    expect(evaluated.status).toBe("needs_review");
  });

  it("reopen gives the case back the agent's amount, not the one the volunteer had set", async () => {
    await seedCase("C-A");
    await applyHumanDecision({ action: "approve", caseIds: ["C-A"], amounts: { "C-A": 120_000 } });
    expect(amountForCase((await getCase("C-A"))!)).toBe(120_000);
    await applyHumanDecision({ action: "reopen", caseIds: ["C-A"] });
    const c = (await getCase("C-A"))!;
    expect(c.humanDecision).toBeUndefined();
    expect(amountForCase(c)).toBe(35_000);
  });

  it("reopen hands the reservation back to the fund", async () => {
    await seedCase("C-A");
    await applyHumanDecision({ action: "approve", caseIds: ["C-A"] });
    await reserveFunds("C-A", 35_000, { actor: "agent", policyClause: "P-9.6", reason: "test" });
    expect((await getFund()).reservedCents).toBe(35_000);

    await applyHumanDecision({ action: "reopen", caseIds: ["C-A"] });
    expect((await getFund()).reservedCents).toBe(0);
    expect((await getCase("C-A"))?.reservedCents).toBe(0);
  });

  it("asking a question also takes an earlier decision back", async () => {
    await seedCase("C-A");
    await applyHumanDecision({ action: "reject", caseIds: ["C-A"], note: "not in the area" });
    await applyHumanDecision({ action: "reopen", caseIds: ["C-A"] });
    const { results } = await applyHumanDecision({ action: "request_info", caseIds: ["C-A"], questions: ["Please send a lease."] });
    expect(results[0]).toMatchObject({ ok: true, status: "needs_info" });
    expect(stored("C-A")).not.toHaveProperty("humanDecision");
    expect((stored("C-A").applicantMessage as { text: string }).text).toContain("Please send a lease.");
  });

  it("a refused decision leaves the reservation alone", async () => {
    await seedCase("C-A");
    await applyHumanDecision({ action: "approve", caseIds: ["C-A"] });
    await reserveFunds("C-A", 35_000, { actor: "agent", policyClause: "P-9.6", reason: "test" });

    // approved → needs_info is not an edge a volunteer has: the question is refused, the money stays reserved.
    const { results } = await applyHumanDecision({ action: "request_info", caseIds: ["C-A"], questions: ["Anything else?"] });
    expect(results[0].ok).toBe(false);
    expect((await getFund()).reservedCents).toBe(35_000);
    expect((stored("C-A").humanDecision as { approved: boolean }).approved).toBe(true);
  });

  it("cannot reject or reopen a case whose money is on its way", async () => {
    await seedCase("C-A", { status: "paying" });
    const rejected = await applyHumanDecision({ action: "reject", caseIds: ["C-A"] });
    const reopened = await applyHumanDecision({ action: "reopen", caseIds: ["C-A"] });
    expect(rejected.results[0].ok).toBe(false);
    expect(reopened.results[0].ok).toBe(false);
    expect(stored("C-A").status).toBe("paying");
  });
});
