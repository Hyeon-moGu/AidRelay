// T-4, the part reevaluation-stale-fields.test.ts does not reach: a case whose first evaluation ran the second,
// separate evaluation (P-9.9) and was parked for money is reopened, asked a question and evaluated again. The new
// evaluation runs no second opinion, so the old one must not stay on the case as if it still agreed.
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, photo: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, downloadObject: vi.fn(async () => state.photo as Buffer), uploadObject: vi.fn(async (p: string) => p) };
});
vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
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
import { submitReply } from "@/lib/intake";
import { applyHumanDecision } from "@/lib/ops/decide";

let db: FakeFirestore;

const answer = (patch: Partial<Decision>): Decision => ({
  eligibility: "eligible",
  tier: 3,
  recommendedAmountCents: null,
  confidence: 0.95,
  reasons: [{ clause: "P-3", evidence: "Photo 1: water line at 60 cm" }],
  redFlags: [],
  followUpQuestions: [],
  applicantLanguage: "en",
  ledgerSummary: "Ground floor flooded; household displaced",
  ...patch,
});

function stubModel(d: Decision) {
  vi.mocked(generateObject).mockImplementation((async (args: { system?: string }) =>
    args.system ? { object: { photos: [{ index: 0, usable: true, description: "standing water" }] }, usage: {} } : { object: d, usage: {} }) as unknown as typeof generateObject);
}

async function evaluate(caseId: string) {
  const ctx: RunContext = { runId: "run-1", trigger: "case.created", limits: limitsFromEnv(getEnv()), policyText: "policy", usage: newUsage() };
  if (!(await db.collection("agent_runs").doc("run-1").get()).exists) await db.collection("agent_runs").doc("run-1").set({ id: "run-1", toolCalls: [] });
  const execute = buildTools(ctx).evaluate_case.execute as (args: object, opts: object) => Promise<unknown>;
  return (await execute({ caseId }, { toolCallId: "t1", messages: [] })) as { status: string };
}

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  state.photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 80, b: 120 } } }).jpeg().toBuffer();
  vi.mocked(generateObject).mockReset();
  await getFund();
});

describe("re-evaluation drops an old second opinion", () => {
  it("clears aiDecisionSecond and secondEvaluationAgrees when the new evaluation runs none", async () => {
    const c = await createCase({
      id: "C-1",
      lang: "en",
      zip: "28501",
      householdSize: 3,
      requestedAmountCents: 25_000,
      narrative: "Water came into the kitchen and the laundry room.",
      photos: ["cases/C-1/photo-1.jpg"],
      docs: [],
      photoHashes: ["00000000ffffffff"],
      contact: { name: "A", email: "a@example.test" },
    });

    stubModel(answer({ tier: 2 })); // $250, auto-approvable, both evaluations agree; the fund is empty → parked
    expect((await evaluate("C-1")).status).toBe("parked");
    const first = (await getCase("C-1")) as CaseDoc;
    expect(first.secondEvaluationAgrees).toBe(true);
    expect(first.aiDecisionSecond).toBeDefined();

    await applyHumanDecision({ action: "reopen", caseIds: ["C-1"] });
    await applyHumanDecision({ action: "request_info", caseIds: ["C-1"], questions: ["Is the washer still working?"] });
    await submitReply(c.token, "Not sure yet.", [], []);

    stubModel(answer({ eligibility: "needs_info", tier: null, followUpQuestions: ["Please send a photo of the washer."] }));
    expect((await evaluate("C-1")).status).toBe("needs_info");

    const after = (await getCase("C-1")) as CaseDoc;
    expect(after.aiDecisionSecond, "second opinion of the earlier evaluation").toBeUndefined();
    expect(after.secondEvaluationAgrees, "agreement of the earlier evaluation").toBeUndefined();
  });
});
