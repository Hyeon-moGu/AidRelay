// P-10 checked inside the payout claim: the calls that lose the race must not keep money reserved or stay
// `approved` for another unattended try. They go to the human queue with their reservation released, as P-10 says.
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

async function seedAutoCase(id: string): Promise<void> {
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
  const patch: Partial<CaseDoc> = { status: "approved", tier: 2, aiDecision: clean, approvedAmountCents: AMOUNT, usableEvidenceCount: 1, secondEvaluationAgrees: true };
  await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
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
  for (let i = 0; i < 19; i++) {
    await db.collection("auto_approvals").doc(`OLD-${i}`).set({ caseId: `OLD-${i}`, amountCents: 100, at: Timestamp.fromMillis(Date.now() - 5 * 60_000) });
  }
});

describe("P-10 inside the claim, for the calls that lose", () => {
  it("one case is paid; the others wait for a human with nothing reserved", async () => {
    const ids = ["C-A", "C-B", "C-C"];
    for (const id of ids) await seedAutoCase(id);

    const results = await Promise.all(ids.map(createPayoutTool));

    const paid = results.filter((r) => r.ok === true);
    expect(paid).toHaveLength(1);
    const statuses = await Promise.all(ids.map(async (id) => (await getCase(id))?.status));
    expect(statuses.filter((s) => s === "paying")).toHaveLength(1);
    expect(statuses.filter((s) => s === "needs_review"), "P-10: beyond the limit, the human queue").toHaveLength(2);
    for (const r of results.filter((x) => x.ok !== true)) expect(r).toMatchObject({ code: "velocity_limit", clause: "P-10" });
    expect((await getFund()).reservedCents, "only the case being paid holds money").toBe(AMOUNT);
  });
});
