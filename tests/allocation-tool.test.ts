// plan_allocation against the in-memory Firestore fake: approved cases the balance cannot cover are parked
// in code (P-8), so the queue and the ledger count them as waiting for funds; cases it can pay are left for
// reserve_funds and create_payout, which must also pay a parked human-approved case once money arrives.
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});

vi.mock("@/lib/paypal/payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/payouts")>();
  return { ...actual, createPayout: vi.fn(), getPayoutBatch: vi.fn() };
});

import { buildTools, type RunContext } from "@/lib/agent/tools";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import { createPayout } from "@/lib/paypal/payouts";
import type { CaseDoc } from "@/lib/db/types";

let db: FakeFirestore;

async function seedApproved(id: string, tier: number, amountCents: number, createdMs: number, human = false) {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: amountCents,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
    createdAt: Timestamp.fromMillis(createdMs),
  });
  const patch: Partial<CaseDoc> = { status: "approved", tier, approvedAmountCents: amountCents };
  if (human) patch.humanDecision = { approved: true, by: "human:ops", amountCents, at: Timestamp.now() };
  await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
}

async function callTool(name: string, args: object): Promise<Record<string, unknown>> {
  const ctx: RunContext = { runId: "run-1", trigger: "donation.captured", limits: {} as RunContext["limits"], policyText: "", usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 } as RunContext["usage"] };
  if (!(await db.collection("agent_runs").doc("run-1").get()).exists) await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
  const execute = buildTools(ctx)[name].execute as (args: object, opts: object) => Promise<unknown>;
  return (await execute(args, { toolCallId: "t1", messages: [] })) as Record<string, unknown>;
}

async function runPlan(): Promise<{ pay: Array<{ id: string }>; park: Array<{ id: string }>; parkedNow: string[] }> {
  return (await callTool("plan_allocation", {})) as unknown as Awaited<ReturnType<typeof runPlan>>;
}

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  await getFund();
});

describe("plan_allocation", () => {
  it("parks the approved cases the balance cannot cover and leaves the payable ones approved", async () => {
    await db.collection("fund").doc("default").update({ raisedCents: 40_000 });
    await seedApproved("C-A", 3, 35_000, 1, true);
    await seedApproved("C-B", 3, 35_000, 2, true);

    const plan = await runPlan();

    expect(plan.pay.map((x) => x.id)).toEqual(["C-A"]);
    expect(plan.parkedNow).toEqual(["C-B"]);
    expect((await getCase("C-A"))?.status).toBe("approved");
    const parked = await getCase("C-B");
    expect(parked?.status).toBe("parked");
    expect(parked?.humanDecision?.approved).toBe(true);
  });

  it("parks every approved case when the fund is empty, and leaves cases already parked as they are", async () => {
    await seedApproved("C-A", 3, 35_000, 1, true);
    await seedApproved("C-B", 2, 25_000, 2);
    await db.collection("cases").doc("C-B").update({ status: "parked" });

    const plan = await runPlan();

    expect(plan.pay).toEqual([]);
    expect(plan.parkedNow).toEqual(["C-A"]);
    expect((await getCase("C-A"))?.status).toBe("parked");
    expect((await getCase("C-B"))?.status).toBe("parked");
  });

  it("pays parked human-approved cases once a donation covers them (park, then resume the human's approval)", async () => {
    vi.mocked(createPayout).mockResolvedValue({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
    await seedApproved("C-A", 3, 35_000, 1, true);
    await seedApproved("C-B", 3, 35_000, 2, true);
    expect((await runPlan()).parkedNow).toEqual(["C-A", "C-B"]);

    await db.collection("fund").doc("default").update({ raisedCents: 70_000 });
    const plan = await runPlan();
    expect(plan.pay.map((x) => x.id)).toEqual(["C-A", "C-B"]);
    for (const { id } of plan.pay) {
      expect(await callTool("reserve_funds", { caseId: id })).toMatchObject({ ok: true });
      expect(await callTool("create_payout", { caseId: id })).toMatchObject({ ok: true, path: "human", amountCents: 35_000 });
      expect((await getCase(id))?.status).toBe("paying");
    }
    const fund = await getFund();
    expect(fund.reservedCents).toBe(70_000);
    expect(fund.raisedCents - fund.paidCents - fund.reservedCents).toBe(0);
  });
});
