// P-8 in create_payout refuses a lower-priority case that already holds a reservation. The refused case must give
// its reservation back; otherwise the family ahead of it cannot reserve, nobody is paid while the fund holds the
// money, and every sweep starts a model session for a plan that can never be carried out.
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OccFirestore } from "./helpers/occ-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/paypal/payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/payouts")>();
  return { ...actual, createPayout: vi.fn(), getPayoutBatch: vi.fn() };
});

import { limitsFromEnv } from "@/lib/agent/guardrails";
import { newUsage } from "@/lib/agent/models";
import type { Decision } from "@/lib/agent/schema";
import { buildTools, planWaitingCases, type RunContext } from "@/lib/agent/tools";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { createPayout } from "@/lib/paypal/payouts";

let db: OccFirestore;

const decision = (tier: 1 | 2 | 3 | 4, cents: number): Decision => ({
  eligibility: "eligible",
  tier,
  recommendedAmountCents: cents,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded; household of 3",
});

async function seed(id: string, createdAtMs: number, patch: Partial<CaseDoc>): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: null,
    narrative: "Water came into the kitchen on Tuesday night.",
    photos: [`cases/${id}/photo-1.jpg`],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
  });
  await db.collection("cases").doc(id).update({ ...patch, "timestamps.created": Timestamp.fromMillis(createdAtMs) } as Record<string, unknown>);
}

async function tool(name: "create_payout" | "reserve_funds", caseId: string): Promise<Record<string, unknown>> {
  const ctx: RunContext = { runId: "run-1", trigger: "operator.command", limits: limitsFromEnv(getEnv()), policyText: "", usage: newUsage() };
  if (!(await db.collection("agent_runs").doc("run-1").get()).exists) await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
  const execute = buildTools(ctx)[name].execute as (args: object, opts: object) => Promise<unknown>;
  return (await execute({ caseId }, { toolCallId: `t-${name}-${caseId}`, messages: [] })) as Record<string, unknown>;
}

beforeEach(async () => {
  db = new OccFirestore();
  state.db = db;
  vi.mocked(createPayout).mockReset();
  vi.mocked(createPayout).mockImplementation(async (input) => ({
    batch_header: { payout_batch_id: `B-${input.caseId}`, batch_status: "PENDING", sender_batch_header: { sender_batch_id: input.senderBatchId } },
  }));
  await getFund();
  // $350 raised, $100 of it already reserved for C-LOW: $250 free.
  await db.collection("fund").doc("default").update({ name: "Relief Fund", raisedCents: 35_000, reservedCents: 10_000 });
});

describe("P-8 refusal in create_payout and the refused case's reservation", () => {
  it("gives the reservation back, so the family ahead of it in the P-8 order is paid", async () => {
    const t = 1_700_000_000_000;
    // C-HIGH: tier 3, a volunteer approved $350. C-LOW: tier 1, $100, auto-approvable, reserved earlier in the run.
    await seed("C-HIGH", t, {
      status: "approved",
      tier: 3,
      aiDecision: decision(3, 35_000),
      approvedAmountCents: 35_000,
      usableEvidenceCount: 1,
      humanDecision: { approved: true, by: "human:ops", amountCents: 35_000, at: Timestamp.now() },
    } as Partial<CaseDoc>);
    await seed("C-LOW", t + 1, { status: "approved", tier: 1, aiDecision: decision(1, 10_000), approvedAmountCents: 10_000, usableEvidenceCount: 1, secondEvaluationAgrees: true, reservedCents: 10_000 });

    // The plan says: pay C-HIGH with the $350 the fund holds.
    expect((await planWaitingCases()).pay.map((p) => p.id)).toEqual(["C-HIGH"]);

    expect(await tool("create_payout", "C-LOW")).toMatchObject({ ok: false, parked: true, clause: "P-8" });
    expect((await getCase("C-LOW"))?.reservedCents ?? 0, "a parked case behind the queue holds no money").toBe(0);

    expect(await tool("create_payout", "C-HIGH")).toMatchObject({ ok: true, path: "human" });
    expect((await getCase("C-HIGH"))?.status).toBe("paying");
  });
});
