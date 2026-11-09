// create_payout on the auto path (no human), against the Firestore fake whose transactions retry on contention:
// P-10 must hold when the agent's parallel tool calls pay several cases at once, and a parked case that hits
// the limit must reach the human queue as P-10 says ("Cases beyond these limits wait in the human queue"). P-8
// holds there too: a call out of the policy order is refused, so nobody jumps a family already waiting.
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
import { buildTools, type RunContext } from "@/lib/agent/tools";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { createPayout } from "@/lib/paypal/payouts";

let db: OccFirestore;
const AMOUNT = 25_000;

const clean: Decision = {
  eligibility: "eligible",
  tier: 2,
  recommendedAmountCents: AMOUNT,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water in the kitchen" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded; household of 3",
};

async function seedAutoCase(id: string, status: "approved" | "parked"): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: AMOUNT,
    narrative: "Water came into the kitchen on Tuesday night.",
    photos: [`cases/${id}/photo-1.jpg`],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
  });
  const patch: Partial<CaseDoc> = { status, tier: 2, aiDecision: clean, approvedAmountCents: AMOUNT, usableEvidenceCount: 1, secondEvaluationAgrees: true };
  await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
}

/** `n` unattended payouts of `cents` each, made `msAgo` ago (the auto_approvals the P-10 check reads). */
async function priorAutoPayouts(n: number, cents: number, msAgo = 5 * 60_000): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.collection("auto_approvals").doc(`OLD-${i}`).set({ caseId: `OLD-${i}`, amountCents: cents, at: Timestamp.fromMillis(Date.now() - msAgo) });
  }
}

async function createPayoutTool(caseId: string): Promise<Record<string, unknown>> {
  const ctx: RunContext = { runId: "run-1", trigger: "donation.captured", limits: limitsFromEnv(getEnv()), policyText: "", usage: newUsage() };
  if (!(await db.collection("agent_runs").doc("run-1").get()).exists) await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
  const execute = buildTools(ctx).create_payout.execute as (args: object, opts: object) => Promise<unknown>;
  return (await execute({ caseId }, { toolCallId: `t-${caseId}`, messages: [] })) as Record<string, unknown>;
}

beforeEach(async () => {
  db = new OccFirestore();
  state.db = db;
  vi.mocked(createPayout).mockReset();
  vi.mocked(createPayout).mockImplementation(async (input) => ({
    batch_header: { payout_batch_id: `B-${input.caseId}`, batch_status: "PENDING", sender_batch_header: { sender_batch_id: input.senderBatchId } },
  }));
  await getFund();
  await db.collection("fund").doc("default").update({ name: "Relief Fund", raisedCents: 1_000_000 });
});

describe("P-10 under the agent's parallel tool calls", () => {
  it("never makes more than 20 unattended payouts in an hour, even when three create_payout calls run at once", async () => {
    await priorAutoPayouts(19, 100);
    for (const id of ["C-A", "C-B", "C-C"]) await seedAutoCase(id, "approved");

    await Promise.all(["C-A", "C-B", "C-C"].map(createPayoutTool));

    const autoPayouts = db.all("auto_approvals").length;
    expect(autoPayouts, "unattended payouts recorded in the last hour").toBeLessThanOrEqual(20);
    expect(vi.mocked(createPayout).mock.calls.length, "PayPal calls made without a human").toBeLessThanOrEqual(1);
  });

  it("never pays more than $5,000 without a human in 24 hours, even when three create_payout calls run at once", async () => {
    await priorAutoPayouts(1, 470_000, 2 * 3_600_000); // $4,700 two hours ago: room for one more $250 grant, not two
    for (const id of ["C-A", "C-B", "C-C"]) await seedAutoCase(id, "approved");

    await Promise.all(["C-A", "C-B", "C-C"].map(createPayoutTool));

    const paidWithoutHuman = db.all("auto_approvals").reduce((sum, a) => sum + (a.amountCents as number), 0);
    expect(paidWithoutHuman, "cents paid without a human in 24 h").toBeLessThanOrEqual(500_000);
  });
});

describe("P-10 for a parked case the agent would pay on its own", () => {
  it("hands the case to the human queue, as it does for an approved one", async () => {
    await priorAutoPayouts(20, 100);
    await seedAutoCase("C-P", "parked");

    const result = await createPayoutTool("C-P");

    expect(vi.mocked(createPayout)).not.toHaveBeenCalled();
    expect((await getCase("C-P"))?.status).toBe("needs_review");
    expect(result).toMatchObject({ ok: false, code: "velocity_limit", clause: "P-10" });
  });

  it("the same refusal for an approved case already lands in the human queue (control)", async () => {
    await priorAutoPayouts(20, 100);
    await seedAutoCase("C-Q", "approved");
    const result = await createPayoutTool("C-Q");
    expect(result).toMatchObject({ ok: false, code: "velocity_limit", clause: "P-10" });
    expect((await getCase("C-Q"))?.status).toBe("needs_review");
  });
});

describe("P-8 in create_payout", () => {
  async function seedWaiting(id: string, status: "approved" | "parked", tier: 1 | 2 | 3 | 4, cents: number): Promise<void> {
    await seedAutoCase(id, status);
    const patch: Partial<CaseDoc> = { tier, aiDecision: { ...clean, tier, recommendedAmountCents: cents }, approvedAmountCents: cents };
    await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
  }

  it("refuses a call that would jump a higher-tier family still waiting for the same money, and parks the case", async () => {
    await db.collection("fund").doc("default").update({ raisedCents: 40_000 });
    await seedWaiting("C-HI", "parked", 3, 25_000);
    await seedWaiting("C-LO", "approved", 1, 20_000);

    const jump = await createPayoutTool("C-LO");
    expect(jump).toMatchObject({ ok: false, parked: true, clause: "P-8" });
    expect(vi.mocked(createPayout)).not.toHaveBeenCalled();
    expect((await getCase("C-LO"))?.status).toBe("parked");

    expect(await createPayoutTool("C-HI")).toMatchObject({ ok: true, path: "auto" });
    expect((await getCase("C-HI"))?.status).toBe("paying");
  });

  it("pays a lower tier when the balance covers everyone ahead of it too", async () => {
    await db.collection("fund").doc("default").update({ raisedCents: 50_000 });
    await seedWaiting("C-HI", "parked", 3, 25_000);
    await seedWaiting("C-LO", "approved", 1, 20_000);
    expect(await createPayoutTool("C-LO")).toMatchObject({ ok: true, path: "auto" });
  });
});

describe("escalate", () => {
  it("joins the model's reasons without doubled punctuation (the volunteer reads this line)", async () => {
    await seedAutoCase("C-E", "approved");
    const ctx: RunContext = { runId: "run-1", trigger: "case.created", limits: limitsFromEnv(getEnv()), policyText: "", usage: newUsage() };
    await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
    const escalate = buildTools(ctx).escalate.execute as (args: object, opts: object) => Promise<unknown>;
    await escalate({ caseId: "C-E", reasons: ["Same photo as C-003, so the agent cannot pay.", " Red flags: duplicate_photo_hash; "], clause: "P-4" }, { toolCallId: "t-e", messages: [] });

    expect((await getCase("C-E"))?.status).toBe("needs_review");
    const row = db.all("audit_log").find((a) => a.action === "case.escalated");
    expect(row?.reason).toBe("Same photo as C-003, so the agent cannot pay; Red flags: duplicate_photo_hash");
  });
});
