// A case goes back to `new` after the applicant answers a volunteer's question and is evaluated again. What the
// second evaluation does not produce (an amount, an agreeing second opinion) must not be carried over from the first.
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
import { amountForCase, type CaseDoc } from "@/lib/db/types";
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

describe("re-evaluation after a volunteer's question", () => {
  it("drops the first evaluation's amount when the second one gives none", async () => {
    const c = await createCase({
      id: "C-1",
      lang: "en",
      zip: "28501",
      householdSize: 4,
      requestedAmountCents: 35_000,
      narrative: "The ground floor flooded and we had to leave the house.",
      photos: ["cases/C-1/photo-1.jpg"],
      docs: [],
      photoHashes: ["00000000ffffffff"],
      contact: { name: "A", email: "a@example.test" },
    });

    stubModel(answer({ tier: 3 })); // $350: over the auto limit → needs_review with the policy amount on file
    expect((await evaluate("C-1")).status).toBe("needs_review");
    expect(amountForCase((await getCase("C-1")) as CaseDoc)).toBe(35_000);

    await applyHumanDecision({ action: "request_info", caseIds: ["C-1"], questions: ["Is the house still standing?"] });
    await submitReply(c.token, "Not sure yet, the inspector has not come.", [], []);

    stubModel(answer({ eligibility: "needs_info", tier: null, followUpQuestions: ["When does the inspector come?"] }));
    expect((await evaluate("C-1")).status).toBe("needs_info");

    const after = (await getCase("C-1")) as CaseDoc;
    expect(after.tier).toBeNull();
    // The current evaluation recommends nothing; the queue and an approval without an amount must not fall back to $350.
    expect(amountForCase(after)).toBeNull();
  });
});
