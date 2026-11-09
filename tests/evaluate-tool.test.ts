// evaluate_case end to end against the in-memory Firestore fake, with the two model calls stubbed:
// where a freshly evaluated, auto-approvable case goes when other cases are already waiting for money (P-8).
import sharp from "sharp";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, photo: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});

vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, downloadObject: vi.fn(async () => state.photo as Buffer) };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: vi.fn() };
});

import { generateObject } from "ai";
import { limitsFromEnv } from "@/lib/agent/guardrails";
import { newUsage } from "@/lib/agent/models";
import type { Decision } from "@/lib/agent/schema";
import { buildTools, type RunContext } from "@/lib/agent/tools";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";

let db: FakeFirestore;
const T0 = 1_700_000_000_000;

const decision = (tier: number): Decision => ({
  eligibility: "eligible",
  tier,
  recommendedAmountCents: null,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: standing water in the kitchen" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Kitchen flooded a few inches; household of 3",
});

/** The pre-screen call passes `system`; the decision calls pass their system prompt inside `messages`. */
function stubModel(tier: number) {
  vi.mocked(generateObject).mockImplementation((async (args: { system?: string }) =>
    args.system ? { object: { photos: [{ index: 0, usable: true, description: "standing water" }] }, usage: {} } : { object: decision(tier), usage: {} }) as unknown as typeof generateObject);
}

async function seedCase(id: string, createdMs: number, patch: Partial<CaseDoc> = {}): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 25_000,
    narrative: "Water came into the kitchen and the laundry room on Tuesday night.",
    photos: [`cases/${id}/photo-1.jpg`],
    docs: [],
    photoHashes: [id === "C-NEW" ? "00000000ffffffff" : "ffffffff00000000"],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
    createdAt: Timestamp.fromMillis(createdMs),
  });
  if (Object.keys(patch).length) await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
}

async function evaluate(caseId: string): Promise<{ status: string; clause: string }> {
  const ctx: RunContext = { runId: "run-1", trigger: "case.created", limits: limitsFromEnv(getEnv()), policyText: "policy", usage: newUsage() };
  await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
  const execute = buildTools(ctx).evaluate_case.execute as (args: object, opts: object) => Promise<unknown>;
  return (await execute({ caseId }, { toolCallId: "t1", messages: [] })) as { status: string; clause: string };
}

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  state.photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 80, b: 120 } } }).jpeg().toBuffer();
  vi.mocked(generateObject).mockReset();
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents: 30_000 });
});

describe("evaluate_case and the waiting queue (P-8)", () => {
  it("approves a clear case the balance covers when nobody is waiting", async () => {
    stubModel(2);
    await seedCase("C-NEW", T0);
    const result = await evaluate("C-NEW");
    expect(result.status).toBe("approved");
    expect((await getCase("C-NEW"))?.secondEvaluationAgrees).toBe(true);
  });

  it("parks a new case behind a waiting case of a higher tier, even though the balance would cover the new one", async () => {
    stubModel(1);
    await seedCase("C-WAIT", T0 - 60_000, { status: "parked", tier: 3, approvedAmountCents: 35_000 });
    await seedCase("C-NEW", T0);
    const result = await evaluate("C-NEW");
    expect(result).toMatchObject({ status: "parked", clause: "P-8" });
    expect((await getCase("C-NEW"))?.status).toBe("parked");
    expect((await getCase("C-NEW"))?.approvedAmountCents).toBe(10_000);
  });

  it("approves a new case that outranks the waiting one", async () => {
    stubModel(2);
    await seedCase("C-WAIT", T0 - 60_000, { status: "parked", tier: 1, approvedAmountCents: 40_000, humanDecision: { approved: true, by: "human:ops", amountCents: 40_000, at: Timestamp.now() } });
    await seedCase("C-NEW", T0);
    const result = await evaluate("C-NEW");
    expect(result.status).toBe("approved");
  });
});

describe("evaluate_case and an address outside the declared area (P-2)", () => {
  it("asks for proof of residence once, then hands the case to a volunteer instead of asking again", async () => {
    stubModel(2);
    await seedCase("C-NEW", T0, { zip: "27312" });
    expect(await evaluate("C-NEW")).toMatchObject({ status: "needs_info", clause: "P-2" });
    expect((await getCase("C-NEW"))?.aiDecision?.followUpQuestions).toHaveLength(1);

    // The applicant answers: submitReply counts the answer and sends the case back for evaluation.
    await db.collection("cases").doc("C-NEW").update({ status: "new", applicantReplies: 1 });
    expect(await evaluate("C-NEW")).toMatchObject({ status: "needs_review", clause: "P-2" });
    const stored = await getCase("C-NEW");
    expect(stored?.status).toBe("needs_review");
    expect(stored?.aiDecision?.followUpQuestions).toEqual([]);
    expect(stored?.redFlags).toContain("zip_outside_declared_area");
  });
});

describe("evaluate_case and the second evaluation's red flags (P-9.5, P-9.9)", () => {
  it("a red flag only the second evaluation raised still sends the case to a volunteer", async () => {
    let decisionCalls = 0;
    vi.mocked(generateObject).mockImplementation((async (args: { system?: string }) => {
      if (args.system) return { object: { photos: [{ index: 0, usable: true, description: "standing water" }] }, usage: {} };
      decisionCalls += 1;
      // Same verdict and tier both times, so the two "agree"; only the second one sees the mismatch.
      return { object: decisionCalls === 1 ? decision(2) : { ...decision(2), redFlags: ["evidence_mismatch"] }, usage: {} };
    }) as unknown as typeof generateObject);
    await seedCase("C-NEW", T0);

    const result = await evaluate("C-NEW");

    expect(result).toMatchObject({ status: "needs_review", clause: "P-3" });
    const c = await getCase("C-NEW");
    expect(c?.secondEvaluationAgrees).toBe(true);
    expect(c?.redFlags).toContain("evidence_mismatch");
  });
});
