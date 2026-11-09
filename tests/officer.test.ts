// What a run leaves behind. A scheduled sweep that finds nothing and a payout update that changes nothing
// record no run and call no model; anything that moves a case or money is recorded for the activity feed.
// Firestore is the in-memory fake, PayPal is mocked, and the model call (generateText) is a stub.
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

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn(async () => ({ text: "Summary.", totalUsage: { inputTokens: 10, outputTokens: 5 }, steps: [] })) };
});

import { generateText } from "ai";
import { runCaseOfficer } from "@/lib/agent/officer";
import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund, reserveFunds } from "@/lib/db/repos/fund";
import { createPayoutForCase } from "@/lib/db/repos/payouts";
import { claimWebhookEvent } from "@/lib/db/repos/webhookEvents";
import type { CaseDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { WebhookEventSchema } from "@/lib/paypal/events";
import { createPayout, getPayoutBatch } from "@/lib/paypal/payouts";

let db: FakeFirestore;

const runs = () => db.all("agent_runs") as Array<{ trigger: string; status: string; summary: string; caseId?: string; toolCalls: Array<{ name: string }> }>;
const meta = { actor: "agent" as const, policyClause: "P-9.6", reason: "test" };

async function seedFund(raisedCents: number) {
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents });
}

async function seedCase(id: string, patch: Partial<CaseDoc>): Promise<void> {
  await createCase({
    id,
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 25_000,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "A", email: `${id.toLowerCase()}@example.test` },
  });
  await db.collection("cases").doc(id).update({ tier: 2, approvedAmountCents: 25_000, ...patch } as Record<string, unknown>);
}

const payoutArgs = (caseId: string) => ({
  caseId,
  amountCents: 25_000,
  currency: "USD",
  recipientEmail: `${caseId.toLowerCase()}@example.test`,
  note: "n",
  actor: "agent" as const,
  policyClause: "P-9",
  reason: "auto",
  autoApproved: true,
});

/** A case whose payout PayPal accepted: `paying`, money reserved, batch B-1. */
async function payingCase(id = "C-1"): Promise<string> {
  await seedFund(100_000);
  await seedCase(id, { status: "approved" });
  await reserveFunds(id, 25_000, meta);
  vi.mocked(createPayout).mockResolvedValue({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
  return (await createPayoutForCase(payoutArgs(id))).senderBatchId;
}

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(generateText).mockClear();
  vi.mocked(createPayout).mockReset();
  vi.mocked(getPayoutBatch).mockReset();
});

describe("sweep", () => {
  it("records nothing and calls no model when there is nothing to do", async () => {
    await seedFund(100_000);
    const result = await runCaseOfficer({ trigger: "sweep" });
    expect(result).toMatchObject({ handled: true, summary: "Sweep: nothing to do." });
    expect(result.runId).toBeUndefined();
    expect(runs()).toHaveLength(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("gives every new case its own session", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "new" });
    await seedCase("C-2", { status: "new" });
    const result = await runCaseOfficer({ trigger: "sweep" });
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.runId).toBeDefined();
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ trigger: "sweep", status: "done" });
  });

  it("parks, in code, an approved case the fund cannot pay: recorded once, no model call, then silent", async () => {
    await seedFund(10_000);
    await seedCase("C-1", { status: "approved" });

    const first = await runCaseOfficer({ trigger: "sweep" });
    expect((await getCase("C-1"))?.status).toBe("parked");
    expect(first.runId).toBeDefined();
    expect(runs()).toHaveLength(1);
    expect(runs()[0].toolCalls.map((t) => t.name)).toEqual(["plan_allocation"]);

    const second = await runCaseOfficer({ trigger: "sweep" });
    expect(second.runId).toBeUndefined();
    expect(runs()).toHaveLength(1);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("runs one allocation session when a waiting case can be paid", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "parked" });
    const result = await runCaseOfficer({ trigger: "sweep" });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(result.runId).toBeDefined();
  });

  it("does not offer the agent a case whose payout PayPal did not accept: it waits for an operator", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockRejectedValue(new PayPalError("PayPal POST /v1/payments/payouts failed (500)", 500, { name: "INTERNAL_ERROR" }));
    await expect(createPayoutForCase(payoutArgs("C-1"))).rejects.toThrow();
    expect(db.read("payouts", "C-1")).toMatchObject({ status: "create_failed" });

    const result = await runCaseOfficer({ trigger: "sweep" });
    expect(result.runId).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
    expect((await getCase("C-1"))?.status).toBe("approved");
    expect((await getFund()).reservedCents).toBe(25_000);
  });

  it("polls a payout PayPal still holds without recording it, and records the poll that settles it", async () => {
    const senderBatchId = await payingCase();
    await db.collection("cases").doc("C-1").update({ "timestamps.approved": Timestamp.fromMillis(Date.now() - 10 * 60_000) });
    const batch = (status: string) => ({
      batch_header: { payout_batch_id: "B-1", batch_status: "PROCESSING", sender_batch_header: { sender_batch_id: senderBatchId } },
      items: [{ payout_item_id: "I-1", transaction_status: status, payout_item: { amount: { value: "250.00", currency: "USD" }, receiver: "r@example.test", sender_item_id: "C-1" } }],
    });

    vi.mocked(getPayoutBatch).mockResolvedValue(batch("UNCLAIMED"));
    const held = await runCaseOfficer({ trigger: "sweep" });
    expect(held.runId).toBeUndefined();
    expect(runs()).toHaveLength(0);
    expect((await getCase("C-1"))?.status).toBe("paying");

    vi.mocked(getPayoutBatch).mockResolvedValue(batch("SUCCESS"));
    const settled = await runCaseOfficer({ trigger: "sweep" });
    expect(settled.runId).toBeDefined();
    expect(runs()[0].toolCalls.map((t) => t.name)).toEqual(["poll_payout"]);
    expect((await getCase("C-1"))?.status).toBe("paid");
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("payout webhook", () => {
  const itemEvent = (id: string, type: string, status: string) =>
    WebhookEventSchema.parse({
      id,
      event_type: type,
      resource: { payout_item_id: "I-1", transaction_status: status, payout_batch_id: "B-1", payout_item: { amount: { value: "250.00", currency: "USD" }, sender_item_id: "C-1" } },
    });

  it("applies a batch status update without recording a run", async () => {
    const senderBatchId = await payingCase();
    await claimWebhookEvent(
      WebhookEventSchema.parse({
        id: "WH-1",
        event_type: "PAYMENT.PAYOUTSBATCH.PROCESSING",
        resource: { batch_header: { payout_batch_id: "B-1", batch_status: "PROCESSING", sender_batch_header: { sender_batch_id: senderBatchId } } },
      }),
    );
    const result = await runCaseOfficer({ trigger: "payout.webhook", eventId: "WH-1" });
    expect(result.runId).toBeUndefined();
    expect(runs()).toHaveLength(0);
    expect(db.read("payouts", "C-1")).toMatchObject({ batchStatus: "PROCESSING" });
  });

  it("records the update that pays the case, with its case id, and stays silent when PayPal repeats it", async () => {
    await payingCase();
    await claimWebhookEvent(itemEvent("WH-2", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS"));
    const paid = await runCaseOfficer({ trigger: "payout.webhook", eventId: "WH-2" });
    expect(paid.runId).toBeDefined();
    expect(paid.summary).toContain("C-1 is paid");
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ trigger: "payout.webhook", status: "done", caseId: "C-1" });
    expect((await getCase("C-1"))?.status).toBe("paid");

    await claimWebhookEvent(itemEvent("WH-3", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS"));
    const again = await runCaseOfficer({ trigger: "payout.webhook", eventId: "WH-3" });
    expect(again.runId).toBeUndefined();
    expect(runs()).toHaveLength(1);
  });

  it("records a failed payout: reservation released, case back with a human", async () => {
    await payingCase();
    await claimWebhookEvent(itemEvent("WH-4", "PAYMENT.PAYOUTS-ITEM.FAILED", "FAILED"));
    const failed = await runCaseOfficer({ trigger: "payout.webhook", eventId: "WH-4" });
    expect(failed.runId).toBeDefined();
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    expect((await getFund()).reservedCents).toBe(0);
  });

  it("keeps an event it could not apply in the feed as an error, and rethrows so PayPal retries", async () => {
    await expect(runCaseOfficer({ trigger: "payout.webhook", eventId: "WH-MISSING" })).rejects.toThrow(/not found/);
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ status: "error" });
  });
});
