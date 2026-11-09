// End-to-end replay of seed/README.md "Demo state" against the in-memory Firestore (serializable variant),
// with the real officer, tools, guardrails, repos and ledger. Only the edges are stubbed: PayPal (create
// accepts, webhooks are replayed), image download, and the two model surfaces: generateObject returns each
// seeded case's `_expected` decision, and generateText is an obedient model that calls the tools exactly as
// OFFICER_SYSTEM's procedures say. Fund totals and statuses are checked after every scene.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Timestamp } from "firebase-admin/firestore";
import type { ToolSet } from "ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OccFirestore } from "./helpers/occ-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, photo: undefined as unknown, toolLog: [] as Array<{ name: string; args: unknown; result: unknown }> }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, downloadObject: vi.fn(async () => state.photo as Buffer), uploadObject: vi.fn(async (p: string) => p) };
});
vi.mock("@/lib/paypal/payouts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/payouts")>();
  return { ...actual, createPayout: vi.fn(), getPayoutBatch: vi.fn() };
});
vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: vi.fn(), generateText: vi.fn() };
});

import { generateObject, generateText } from "ai";
import { runCaseOfficer } from "@/lib/agent/officer";
import type { Decision } from "@/lib/agent/schema";
import { createCase, getCase, listAllCases } from "@/lib/db/repos/cases";
import { recordDonationCapture } from "@/lib/db/repos/donations";
import { getFund } from "@/lib/db/repos/fund";
import { claimWebhookEvent } from "@/lib/db/repos/webhookEvents";
import { fundBalanceCents, type PayoutDoc } from "@/lib/db/types";
import { buildLedger } from "@/lib/ledger/public";
import { applyHumanDecision } from "@/lib/ops/decide";
import { WebhookEventSchema } from "@/lib/paypal/events";
import { createPayout } from "@/lib/paypal/payouts";
import { buildSeedPlan, type PlannedCase } from "@/lib/seed/plan";

const ROOT = process.cwd();
const seedRaw = JSON.parse(readFileSync(path.join(ROOT, "seed", "cases.json"), "utf8"));
const accountsRaw = JSON.parse(readFileSync(path.join(ROOT, "seed", "accounts.example.json"), "utf8"));
const accounts = Object.fromEntries(
  Object.keys(accountsRaw)
    .filter((k) => !k.startsWith("_"))
    .map((k) => [k, { email: `${k.toLowerCase()}@personal.example.com` }]),
);
const fullPlan = buildSeedPlan(seedRaw, accounts);
const demoPlan = buildSeedPlan(seedRaw, accounts, { demo: true });
const byId = new Map(fullPlan.cases.map((c) => [c.id, c]));

let db: OccFirestore;
let webhookSeq = 0;

const hashOf = (p: string) => createHash("sha256").update(p).digest("hex").slice(0, 16);

async function seedCase(c: PlannedCase, createdMs: number): Promise<void> {
  const files = [...c.photos, ...c.docs];
  await createCase({
    id: c.id,
    lang: c.lang,
    zip: c.zip,
    householdSize: c.householdSize,
    requestedAmountCents: c.requestedAmountCents,
    narrative: c.narrative,
    photos: c.photos.map((_, i) => `cases/${c.id}/photo-${i + 1}.jpg`),
    docs: c.docs.map((_, i) => `cases/${c.id}/doc-${i + 1}.jpg`),
    photoHashes: files.map(hashOf),
    contact: { name: c.contact.name, email: c.contact.email.toLowerCase(), phone: c.contact.phone, address: c.contact.address },
    createdAt: Timestamp.fromMillis(createdMs),
  });
}

/** What the decision model answers for a seeded case: its `_expected`, minus the flags code adds itself. */
function decisionFor(caseId: string): Decision {
  const c = byId.get(caseId);
  if (!c) throw new Error(`no seed case ${caseId}`);
  const e = (c.expected ?? {}) as { eligibility?: Decision["eligibility"]; tier?: number | null; redFlags?: string[] };
  const codeFlags = new Set(["duplicate_photo_hash", "duplicate_address", "duplicate_contact", "zip_outside_declared_area", "amount_outlier"]);
  const eligibility = e.eligibility ?? "eligible";
  return {
    eligibility,
    tier: e.tier ?? null,
    recommendedAmountCents: null,
    confidence: 0.95,
    reasons: [{ clause: "P-3", evidence: "Photo 1: water line on the wall" }],
    redFlags: (e.redFlags ?? []).filter((f) => !codeFlags.has(f)) as Decision["redFlags"],
    followUpQuestions: eligibility === "needs_info" ? [c.lang === "es" ? "¿Cuántas personas viven en su casa?" : "How many people live in your home?"] : [],
    applicantLanguage: c.lang,
    ledgerSummary: `Flood damage to the home; household of ${c.householdSize ?? "unknown size"}`,
  };
}

function stubDecisionModel() {
  vi.mocked(generateObject).mockImplementation((async (args: { system?: string; messages: Array<{ role: string; content: unknown }> }) => {
    if (args.system) {
      const user = args.messages[0].content as Array<{ type: string }>;
      const n = user.filter((p) => p.type === "image").length;
      return { object: { photos: Array.from({ length: n }, (_, index) => ({ index, usable: true, description: "standing water" })) }, usage: {} };
    }
    const user = args.messages.at(-1)!.content as Array<{ type: string; text?: string }>;
    const text = user.find((p) => p.type === "text")?.text ?? "";
    const id = /^Case (C-\w+)/m.exec(text)?.[1];
    return { object: decisionFor(id!), usage: {} };
  }) as unknown as typeof generateObject);
}

/** A model that follows OFFICER_SYSTEM to the letter. */
function stubObedientOfficer() {
  vi.mocked(generateText).mockImplementation((async (args: { tools: ToolSet; messages: Array<{ role: string; content: unknown }> }) => {
    const prompt = String(args.messages.at(-1)!.content);
    const call = async (name: string, a: Record<string, unknown>) => {
      const result = (await (args.tools[name].execute as (x: object, o: object) => Promise<unknown>)(a, { toolCallId: name, messages: [] })) as Record<string, unknown>;
      state.toolLog.push({ name, args: a, result });
      return result;
    };
    const fresh = /new application arrived: case (C-\w+)/.exec(prompt);
    if (fresh) {
      const id = fresh[1];
      await call("get_case", { caseId: id });
      await call("check_duplicates", { caseId: id });
      const r = await call("evaluate_case", { caseId: id });
      const d = r.decision as Decision | null;
      if (r.status === "approved") {
        await call("reserve_funds", { caseId: id });
        await call("create_payout", { caseId: id });
      } else if (r.status === "needs_info") {
        await call("request_info", { caseId: id, questions: d?.followUpQuestions.length ? d.followUpQuestions : ["Please add a photo."], lang: d?.applicantLanguage === "es" ? "es" : "en" });
      } else if (r.status === "needs_review") {
        await call("escalate", { caseId: id, reasons: [String(r.reason ?? "needs a human")], clause: String(r.clause ?? "P-9") });
      } else if (r.status === "parked") {
        await call("note", { caseId: id, text: "Waits for funds (P-8)." });
      }
    } else {
      await call("get_fund_balance", {});
      const plan = await call("plan_allocation", {});
      for (const p of (plan.pay as Array<{ id: string }>) ?? []) {
        await call("reserve_funds", { caseId: p.id });
        await call("create_payout", { caseId: p.id });
      }
    }
    return { text: "Summary.", totalUsage: { inputTokens: 1, outputTokens: 1 }, steps: [] };
  }) as unknown as typeof generateText);
}

async function donate(orderId: string, cents: number) {
  const r = await recordDonationCapture({ orderId, captureId: `CAP-${orderId}`, captureStatus: "COMPLETED", amountCents: cents, currency: "USD", raw: {}, source: "api" });
  expect(r.applied).toBe(true);
}

/** PayPal pays every batch it accepted: one PAYOUTS-ITEM.SUCCEEDED webhook per payout still pending. */
async function payPayPalBatches(): Promise<string[]> {
  const paid: string[] = [];
  for (const p of db.all("payouts") as unknown as PayoutDoc[]) {
    if (p.outcome !== "pending" || !p.payoutBatchId) continue;
    const id = `WH-${++webhookSeq}`;
    await claimWebhookEvent(
      WebhookEventSchema.parse({
        id,
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: { payout_item_id: `I-${p.caseId}`, transaction_status: "SUCCESS", payout_batch_id: p.payoutBatchId, payout_item: { amount: { value: (p.amountCents / 100).toFixed(2), currency: "USD" }, sender_item_id: p.caseId } },
      }),
    );
    await runCaseOfficer({ trigger: "payout.webhook", eventId: id });
    paid.push(p.caseId);
  }
  return paid;
}

async function fundTotals() {
  const f = await getFund();
  const totals = { raised: f.raisedCents / 100, paid: f.paidCents / 100, reserved: f.reservedCents / 100, balance: fundBalanceCents(f) / 100 };
  // Invariants that must hold after every scene.
  expect(totals.balance).toBeGreaterThanOrEqual(0);
  const cases = await listAllCases();
  const reservedOnCases = cases.reduce((s, c) => s + (c.reservedCents ?? 0), 0) / 100;
  expect(reservedOnCases).toBe(totals.reserved);
  const paidOnCases = cases.filter((c) => c.status === "paid").reduce((s, c) => s + ((db.read("payouts", c.id) as { amountCents: number }).amountCents ?? 0), 0) / 100;
  expect(paidOnCases).toBe(totals.paid);
  expect(cases.some((c) => c.status === "rejected")).toBe(false);
  return totals;
}

async function statuses(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const c of await listAllCases()) (out[c.status] ??= []).push(c.id);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `C-${String(from + i).padStart(3, "0")}`);
const failures = () => state.toolLog.filter((t) => (t.result as { ok?: boolean })?.ok === false);
/** Tool calls the activity feed would show in red: a refusal or an exception, not a case that simply parks. */
const errors = () => state.toolLog.filter((t) => typeof (t.result as { error?: unknown })?.error === "string").map((t) => `${t.name} ${(t.args as { caseId?: string }).caseId}: ${(t.result as { error: string }).error}`);

beforeAll(async () => {
  state.photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 80, b: 120 } } }).jpeg().toBuffer();
});

beforeEach(async () => {
  db = new OccFirestore();
  state.db = db;
  state.toolLog = [];
  webhookSeq = 0;
  vi.mocked(generateObject).mockReset();
  vi.mocked(generateText).mockReset();
  vi.mocked(createPayout).mockReset();
  vi.mocked(createPayout).mockImplementation(async (input) => ({ batch_header: { payout_batch_id: `B${input.caseId.replace(/\W/g, "")}`, batch_status: "PENDING", sender_batch_header: { sender_batch_id: input.senderBatchId } } }));
  stubDecisionModel();
  stubObedientOfficer();
  await getFund();
  await db.collection("fund").doc("default").update({ name: seedRaw.fund.name });
});

async function seedDemo() {
  expect(demoPlan.cases.map((c) => c.id)).toEqual(range(2, 22));
  const t0 = Date.now() - 60 * 60_000;
  let i = 0;
  for (const c of demoPlan.cases) await seedCase(c, t0 + 1_000 * i++);
}

describe("seed/README.md Demo state, replayed", () => {
  it("every scene lands on the README's numbers", async () => {
    await seedDemo();

    // 2. $4,500 donated by hand.
    await donate("O-1", 300_000);
    await donate("O-2", 150_000);
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 0, reserved: 0, balance: 4_500 });

    // 3. pnpm agent:sweep
    const sweep = await runCaseOfficer({ trigger: "sweep" });
    expect(sweep.runId).toBeDefined();
    expect(generateText).toHaveBeenCalledTimes(21); // one session per new case, no allocation session (nothing waits)
    expect(failures()).toEqual([]);
    const tier2Bulk = range(11, 18);
    const tier3Bulk = range(19, 22);
    expect((await statuses()).paying).toEqual(["C-002", "C-006", ...tier2Bulk]);
    await payPayPalBatches();
    expect(await statuses()).toEqual({
      paid: ["C-002", "C-006", ...tier2Bulk],
      needs_review: ["C-003", "C-004", "C-005", "C-009", "C-010", ...tier3Bulk],
      needs_info: ["C-007", "C-008"],
    });
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 2_500, reserved: 0, balance: 2_000 });

    // 4. On camera: C-001 applies and auto-pays.
    await seedCase(byId.get("C-001")!, Date.now());
    await runCaseOfficer({ trigger: "case.created", caseId: "C-001" });
    expect((await getCase("C-001"))?.status).toBe("paying");
    await payPayPalBatches();
    expect((await getCase("C-001"))?.status).toBe("paid");
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 2_750, reserved: 0, balance: 1_750 });

    // 5. On camera: the operator approves the six rows; the agent pays four and parks exactly two.
    const sixRows = ["C-004", "C-003", ...tier3Bulk];
    const decided = await applyHumanDecision({ action: "approve", caseIds: sixRows });
    expect(decided.results.every((r) => r.ok)).toBe(true);
    expect(decided.results.map((r) => r.amountCents)).toEqual([55_000, 35_000, 35_000, 35_000, 35_000, 35_000]);
    await runCaseOfficer({ trigger: "operator.command", command: "An operator approved 6 case(s)" });
    expect(failures()).toEqual([]);
    const after5 = await statuses();
    expect(after5.paying).toEqual(["C-003", "C-004", "C-019", "C-020"]);
    expect(after5.parked).toEqual(["C-021", "C-022"]);
    const payOrder = state.toolLog.filter((t) => t.name === "create_payout").map((t) => (t.args as { caseId: string }).caseId).slice(-4);
    expect(payOrder).toEqual(["C-004", "C-003", "C-019", "C-020"]);
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 2_750, reserved: 1_600, balance: 150 });
    await payPayPalBatches();
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 4_350, reserved: 0, balance: 150 });

    // 6. On camera: DONOR gives $700; the agent pays exactly #3 and #4.
    const before6 = state.toolLog.length;
    await donate("O-3", 70_000);
    await runCaseOfficer({ trigger: "donation.captured", orderId: "O-3" });
    const created6 = state.toolLog.slice(before6).filter((t) => t.name === "create_payout");
    expect(created6.map((t) => (t.args as { caseId: string }).caseId)).toEqual(["C-021", "C-022"]);
    await payPayPalBatches();
    expect(await fundTotals()).toEqual({ raised: 5_200, paid: 5_050, reserved: 0, balance: 150 });
    expect(failures()).toEqual([]);

    // One payout per case, never two batches for one case.
    const payouts = db.all("payouts") as unknown as PayoutDoc[];
    expect(payouts).toHaveLength(17);
    expect(new Set(payouts.map((p) => p.payoutBatchId)).size).toBe(17);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(17);

    // Public ledger: totals, every paid row with a batch id, 11 of 17 paid without a human, no PII.
    const ledger = await buildLedger();
    expect(ledger.fund).toMatchObject({ raisedCents: 520_000, paidCents: 505_000, reservedCents: 0, balanceCents: 15_000 });
    expect(ledger.metrics.casesPaid).toBe(17);
    expect(ledger.metrics.autoPaidShare).toBeCloseTo(11 / 17);
    expect(ledger.metrics.duplicatePayouts).toBe(0);
    expect(ledger.metrics.paidWithBatchIdShare).toBe(1);
    const json = JSON.stringify(ledger);
    for (const c of fullPlan.cases) {
      expect(json).not.toContain(c.contact.email);
      if (c.contact.address && /^\d/.test(c.contact.address)) expect(json).not.toContain(c.contact.address.split(",")[0]);
      expect(json).not.toContain(c.contact.name);
    }
    expect(json).not.toContain("[redacted]");
  });

  it("the six-row scene holds when the scheduled sweep fires in the middle of the operator's run", async () => {
    await seedDemo();
    await donate("O-1", 300_000);
    await donate("O-2", 150_000);
    await runCaseOfficer({ trigger: "sweep" });
    await payPayPalBatches();
    await seedCase(byId.get("C-001")!, Date.now());
    await runCaseOfficer({ trigger: "case.created", caseId: "C-001" });
    await payPayPalBatches();
    const callsBefore = vi.mocked(createPayout).mock.calls.length;

    await applyHumanDecision({ action: "approve", caseIds: ["C-004", "C-003", ...range(19, 22)] });
    // Cloud Scheduler's sweep (every 10 minutes) and the operator's run start together.
    await Promise.all([runCaseOfficer({ trigger: "operator.command", command: "An operator approved 6 case(s)" }), runCaseOfficer({ trigger: "sweep" })]);

    const s = await statuses();
    expect(s.parked).toEqual(["C-021", "C-022"]);
    expect(s.paying).toEqual(["C-003", "C-004", "C-019", "C-020"]);
    expect(vi.mocked(createPayout).mock.calls.length - callsBefore).toBe(4); // never a second PayPal call for one case
    expect(await fundTotals()).toEqual({ raised: 4_500, paid: 2_750, reserved: 1_600, balance: 150 });
    // What the activity feed shows on camera: the run that lost the race reports "already in payment", not errors.
    expect(errors()).toEqual([]);
    expect(state.toolLog.some((t) => (t.result as { alreadyHandled?: boolean })?.alreadyHandled)).toBe(true);
  });

  it("a donation arriving while the operator's run is still paying does not overdraw or pay twice", async () => {
    await seedDemo();
    await donate("O-1", 300_000);
    await donate("O-2", 150_000);
    await runCaseOfficer({ trigger: "sweep" });
    await payPayPalBatches();
    await seedCase(byId.get("C-001")!, Date.now());
    await runCaseOfficer({ trigger: "case.created", caseId: "C-001" });
    await payPayPalBatches();

    await applyHumanDecision({ action: "approve", caseIds: ["C-004", "C-003", ...range(19, 22)] });
    await donate("O-3", 70_000);
    await Promise.all([
      runCaseOfficer({ trigger: "operator.command", command: "An operator approved 6 case(s)" }),
      runCaseOfficer({ trigger: "donation.captured", orderId: "O-3" }),
    ]);
    await payPayPalBatches();
    const s = await statuses();
    expect(s.parked ?? []).toEqual([]);
    expect(await fundTotals()).toEqual({ raised: 5_200, paid: 5_050, reserved: 0, balance: 150 });
    const payouts = db.all("payouts") as unknown as PayoutDoc[];
    expect(payouts).toHaveLength(17);
    expect(errors()).toEqual([]);
  });
});
