// Money-moving repo logic against the in-memory Firestore fake: reservation/settlement invariants,
// capture idempotency across the API and webhook paths, the payout claim, and payout event sequences.
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

import { GuardrailError } from "@/lib/agent/guardrails";
import { claimForEvaluation, createCase, getCase, resetStaleEvaluating, setCaseStatus } from "@/lib/db/repos/cases";
import { getDonation, recordDonationCapture } from "@/lib/db/repos/donations";
import { getFund, InsufficientFundsError, releaseFunds, reserveFunds, settlePaid } from "@/lib/db/repos/fund";
import { applyPayoutEvent, createPayoutForCase, getPayout } from "@/lib/db/repos/payouts";
import { claimWebhookEvent, markWebhookHandled } from "@/lib/db/repos/webhookEvents";
import { fundBalanceCents, type CaseDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, type PayoutEventInfo } from "@/lib/paypal/payouts";

let db: FakeFirestore;

async function seedFund(raisedCents: number) {
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents });
}

async function seedCase(id: string, patch: Partial<CaseDoc> = {}): Promise<CaseDoc> {
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
  if (Object.keys(patch).length) await db.collection("cases").doc(id).update(patch as Record<string, unknown>);
  return (await getCase(id)) as CaseDoc;
}

async function invariantHolds() {
  const f = await getFund();
  expect(f.raisedCents - f.paidCents - f.reservedCents, "raised − paid − reserved must never go negative").toBeGreaterThanOrEqual(0);
  expect(f.reservedCents).toBeGreaterThanOrEqual(0);
  expect(f.paidCents).toBeGreaterThanOrEqual(0);
  return f;
}

const meta = { actor: "agent" as const, policyClause: "P-9.6", reason: "test" };

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(createPayout).mockReset();
});

describe("reserve / release / settle", () => {
  it("reserves only for approved or parked cases and keeps the fund invariant", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    let f = await invariantHolds();
    expect(f.reservedCents).toBe(25_000);
    expect(fundBalanceCents(f)).toBe(75_000);
    expect((await getCase("C-1"))?.reservedCents).toBe(25_000);

    await reserveFunds("C-1", 25_000, meta); // idempotent
    expect((await getFund()).reservedCents).toBe(25_000);

    await reserveFunds("C-1", 35_000, meta); // a different amount replaces the earlier reservation
    f = await invariantHolds();
    expect(f.reservedCents).toBe(35_000);

    await seedCase("C-2", { status: "needs_review" });
    await expect(reserveFunds("C-2", 25_000, meta)).rejects.toBeInstanceOf(GuardrailError);
    await seedCase("C-3", { status: "paid" });
    await expect(reserveFunds("C-3", 25_000, meta)).rejects.toBeInstanceOf(GuardrailError);
    expect((await getFund()).reservedCents).toBe(35_000);
  });

  it("never overdraws", async () => {
    await seedFund(30_000);
    await seedCase("C-1", { status: "approved" });
    await seedCase("C-2", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    await expect(reserveFunds("C-2", 25_000, meta)).rejects.toBeInstanceOf(InsufficientFundsError);
    const f = await invariantHolds();
    expect(f.reservedCents).toBe(25_000);
    expect((await getCase("C-2"))?.reservedCents ?? 0).toBe(0);
  });

  it("releases, refuses to release money in flight, and settles exactly once", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    await releaseFunds("C-1", meta);
    expect((await getFund()).reservedCents).toBe(0);

    await reserveFunds("C-1", 25_000, meta);
    await db.collection("cases").doc("C-1").update({ status: "paying" });
    await expect(releaseFunds("C-1", meta)).rejects.toBeInstanceOf(GuardrailError);
    await expect(releaseFunds("C-1", meta, { afterFailedPayout: true })).resolves.toEqual({ releasedCents: 25_000 });

    await reserveFunds("C-1", 25_000, { ...meta, actor: "system" }).catch(() => undefined); // paying: reserve refused
    await db.collection("cases").doc("C-1").update({ status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    await db.collection("cases").doc("C-1").update({ status: "paying" });
    const first = await settlePaid("C-1", 25_000, { actor: "system", policyClause: "P-9", reason: "test", payoutBatchId: "B1" });
    const second = await settlePaid("C-1", 25_000, { actor: "system", policyClause: "P-9", reason: "test" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    const f = await invariantHolds();
    expect(f.paidCents).toBe(25_000);
    expect(f.reservedCents).toBe(0);
    const c = await getCase("C-1");
    expect(c?.status).toBe("paid");
    expect(c?.payoutBatchId).toBe("B1");
    expect(c?.timestamps.paid).toBeInstanceOf(Timestamp);
  });
});

describe("recordDonationCapture (API path and webhook path)", () => {
  const input = { orderId: "O-1", captureId: "CAP-1", captureStatus: "COMPLETED", amountCents: 2_000, currency: "USD" };

  it("adds to raisedCents exactly once whichever path lands first", async () => {
    await seedFund(0);
    const a = await recordDonationCapture({ ...input, source: "api", payerEmail: "donor@example.test" });
    const b = await recordDonationCapture({ ...input, source: "webhook" });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    expect((await getFund()).raisedCents).toBe(2_000);
    const d = await getDonation("O-1");
    expect(d?.status).toBe("captured");
    expect(d?.source).toBe("api");
    expect(d?.donorRef).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(d)).not.toContain("donor@example.test");
    expect(db.all("audit_log").filter((a) => a.action === "donation.captured")).toHaveLength(1);
  });

  it("webhook first, then the API response: same result", async () => {
    await seedFund(0);
    const a = await recordDonationCapture({ ...input, source: "webhook" });
    const b = await recordDonationCapture({ ...input, source: "api" });
    expect([a.applied, b.applied]).toEqual([true, false]);
    expect((await getFund()).raisedCents).toBe(2_000);
  });

  it("a PENDING capture is recorded but not counted until COMPLETED", async () => {
    await seedFund(0);
    const p = await recordDonationCapture({ ...input, captureStatus: "PENDING", source: "api" });
    expect(p.applied).toBe(false);
    expect((await getDonation("O-1"))?.status).toBe("pending");
    expect((await getFund()).raisedCents).toBe(0);
    const c = await recordDonationCapture({ ...input, source: "webhook" });
    expect(c.applied).toBe(true);
    expect((await getFund()).raisedCents).toBe(2_000);
  });
});

describe("createPayoutForCase", () => {
  const args = {
    caseId: "C-1",
    amountCents: 25_000,
    currency: "USD",
    recipientEmail: "r1@example.test",
    note: "Relief grant",
    actor: "agent" as const,
    policyClause: "P-9",
    reason: "auto",
    autoApproved: true,
  };

  it("claims the payout, records the P-10 entry, calls PayPal once with a nonce key, then stores the batch id", async () => {
    await seedFund(100_000);
    const c = await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockResolvedValue({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });

    const payout = await createPayoutForCase(args);
    expect(payout.senderBatchId).toBe(`C-1-${c.token.slice(0, 8)}`);
    expect(payout.payoutBatchId).toBe("B-1");
    expect(payout.status).toBe("PENDING");
    expect(payout.batchStatus).toBe("PENDING");
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPayout).mock.calls[0][0]).toMatchObject({ caseId: "C-1", senderBatchId: payout.senderBatchId, amountCents: 25_000 });
    expect((await getCase("C-1"))?.status).toBe("paying");
    expect((await getCase("C-1"))?.payoutBatchId).toBe("B-1");
    expect(db.read("auto_approvals", "C-1")).toMatchObject({ caseId: "C-1", amountCents: 25_000 });

    await expect(createPayoutForCase(args)).rejects.toThrow(/already exists/);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(1);
  });

  it("refuses without a matching reservation and leaves no payout record", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await expect(createPayoutForCase(args)).rejects.toThrow(/reserved/);
    expect(await getPayout("C-1")).toBeUndefined();
    expect(vi.mocked(createPayout)).not.toHaveBeenCalled();
  });

  it("on a PayPal error: create_failed, case back to approved, reservation kept, retry blocked", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockRejectedValue(new PayPalError("PayPal POST failed (400)", 400, { name: "VALIDATION_ERROR" }));

    await expect(createPayoutForCase(args)).rejects.toBeInstanceOf(PayPalError);
    const p = await getPayout("C-1");
    expect(p?.status).toBe("create_failed");
    expect(p?.outcome).toBe("create_failed");
    expect((await getCase("C-1"))?.status).toBe("approved");
    expect((await getFund()).reservedCents).toBe(25_000);
    await expect(createPayoutForCase(args)).rejects.toThrow(/already exists/);
  });

  it("does not clobber a status a fast webhook already settled", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockImplementation(async () => {
      // The SUCCEEDED webhook lands while PayPal is still answering the create call.
      await applyPayoutEvent({ kind: "item", caseId: "C-1", payoutBatchId: "B-1", status: "SUCCESS", outcome: "paid" }, "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
      return { batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } };
    });
    await createPayoutForCase(args);
    const p = await getPayout("C-1");
    expect(p?.status).toBe("SUCCESS");
    expect(p?.outcome).toBe("paid");
    expect(p?.batchStatus).toBe("PENDING");
    expect((await getCase("C-1"))?.status).toBe("paid");
  });
});

describe("applyPayoutEvent sequences", () => {
  async function payingCase(): Promise<{ senderBatchId: string }> {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockResolvedValue({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
    const p = await createPayoutForCase({
      caseId: "C-1",
      amountCents: 25_000,
      currency: "USD",
      recipientEmail: "r1@example.test",
      note: "n",
      actor: "agent",
      policyClause: "P-9",
      reason: "auto",
      autoApproved: true,
    });
    return { senderBatchId: p.senderBatchId };
  }
  const item = (status: string, extra: Partial<PayoutEventInfo> = {}): PayoutEventInfo => ({
    kind: "item",
    caseId: "C-1",
    payoutBatchId: "B-1",
    status,
    outcome: status === "SUCCESS" ? "paid" : ["FAILED", "RETURNED", "REFUNDED", "DENIED", "BLOCKED", "CANCELED", "REVERSED"].includes(status) ? "failed" : "pending",
    ...extra,
  });

  it("SUCCEEDED settles once; a second SUCCEEDED is a no-op", async () => {
    await payingCase();
    const a = await applyPayoutEvent(item("SUCCESS"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    const b = await applyPayoutEvent(item("SUCCESS"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect(a).toMatchObject({ caseId: "C-1", outcome: "paid", changed: true });
    expect(b).toMatchObject({ outcome: "paid", changed: false });
    const f = await invariantHolds();
    expect(f.paidCents).toBe(25_000);
    expect(f.reservedCents).toBe(0);
    expect((await getCase("C-1"))?.status).toBe("paid");
  });

  it("UNCLAIMED waits; RETURNED afterwards releases the reservation and hands the case to a human", async () => {
    await payingCase();
    const u = await applyPayoutEvent(item("UNCLAIMED"), "webhook", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED");
    expect(u).toMatchObject({ outcome: "pending", changed: false });
    expect((await getPayout("C-1"))?.status).toBe("UNCLAIMED");
    expect((await getCase("C-1"))?.status).toBe("paying");

    const r = await applyPayoutEvent(item("RETURNED", { error: "Receiver did not claim" }), "webhook", "PAYMENT.PAYOUTS-ITEM.RETURNED");
    expect(r).toMatchObject({ outcome: "failed", changed: true });
    const f = await invariantHolds();
    expect(f.reservedCents).toBe(0);
    expect(f.paidCents).toBe(0);
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    expect((await getPayout("C-1"))?.error).toBe("Receiver did not claim");
  });

  it("REFUNDED after SUCCESS reverses paidCents and reopens the case for a human", async () => {
    await payingCase();
    await applyPayoutEvent(item("SUCCESS"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    const r = await applyPayoutEvent(item("REFUNDED"), "webhook", "PAYMENT.PAYOUTS-ITEM.REFUNDED");
    expect(r).toMatchObject({ outcome: "failed", changed: true, note: "paid payout reversed" });
    const f = await invariantHolds();
    expect(f.paidCents).toBe(0);
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    expect((await getPayout("C-1"))?.outcome).toBe("reversed");
    expect(db.all("audit_log").some((a) => a.action === "payout.reversed")).toBe(true);
    // and again: no double reversal
    const again = await applyPayoutEvent(item("REFUNDED"), "webhook", "PAYMENT.PAYOUTS-ITEM.REFUNDED");
    expect(again.changed).toBe(false);
    expect((await getFund()).paidCents).toBe(0);
  });

  it("a batch DENIED event finds the case by senderBatchId and fails it", async () => {
    const { senderBatchId } = await payingCase();
    const r = await applyPayoutEvent({ kind: "batch", senderBatchId, payoutBatchId: "B-1", status: "DENIED", outcome: "failed" }, "webhook", "PAYMENT.PAYOUTSBATCH.DENIED");
    expect(r).toMatchObject({ caseId: "C-1", outcome: "failed", changed: true });
    expect((await getPayout("C-1"))?.batchStatus).toBe("DENIED");
    expect((await getPayout("C-1"))?.status).toBe("PENDING"); // item status untouched by a batch event
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    expect((await getFund()).reservedCents).toBe(0);
  });

  it("ignores events for another batch (another environment on the same sandbox app)", async () => {
    await payingCase();
    const r = await applyPayoutEvent(item("SUCCESS", { payoutBatchId: "B-OTHER" }), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect(r).toMatchObject({ changed: false, note: expect.stringContaining("another batch") });
    expect((await getCase("C-1"))?.status).toBe("paying");
    expect((await getFund()).paidCents).toBe(0);
    expect(db.all("audit_log").some((a) => a.action === "payout.event_ignored")).toBe(true);
  });

  it("an event with no payout record is a no-op with a note", async () => {
    await seedFund(0);
    const r = await applyPayoutEvent(item("SUCCESS", { caseId: "C-404" }), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect(r).toMatchObject({ changed: false, note: expect.stringContaining("no payout record") });
  });

  it("a failure after create_failed (PayPal accepted a timed-out call) still releases the reservation", async () => {
    await seedFund(100_000);
    await seedCase("C-1", { status: "approved" });
    await reserveFunds("C-1", 25_000, meta);
    vi.mocked(createPayout).mockRejectedValue(new Error("socket hang up"));
    await createPayoutForCase({ caseId: "C-1", amountCents: 25_000, currency: "USD", recipientEmail: "r", note: "n", actor: "agent", policyClause: "P-9", reason: "x", autoApproved: false }).catch(() => undefined);
    expect((await getPayout("C-1"))?.outcome).toBe("create_failed");
    const r = await applyPayoutEvent(item("FAILED"), "webhook", "PAYMENT.PAYOUTS-ITEM.FAILED");
    expect(r).toMatchObject({ outcome: "failed", changed: true });
    expect((await getFund()).reservedCents).toBe(0);
    expect((await getCase("C-1"))?.status).toBe("needs_review");
  });
});

describe("webhook event claims", () => {
  const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "x" } };
  it("new → retry (until handled) → duplicate", async () => {
    expect(await claimWebhookEvent(event)).toBe("new");
    expect(await claimWebhookEvent(event)).toBe("retry");
    await markWebhookHandled("WH-1", { ok: true });
    expect(await claimWebhookEvent(event)).toBe("duplicate");
  });
});

describe("evaluation lock and status machine", () => {
  it("claims new cases, answers busy while fresh, reclaims a stale lock, refuses other statuses", async () => {
    await seedCase("C-1");
    const t0 = 1_000_000_000_000;
    expect(await claimForEvaluation("C-1", t0)).toBe("claimed");
    expect((await getCase("C-1"))?.status).toBe("evaluating");
    expect(await claimForEvaluation("C-1", t0 + 60_000)).toBe("busy");
    expect(await claimForEvaluation("C-1", t0 + 11 * 60_000)).toBe("claimed");
    await seedCase("C-2", { status: "approved" });
    expect(await claimForEvaluation("C-2", t0)).toBe("not_claimable");

    const reset = await resetStaleEvaluating(t0 + 30 * 60_000);
    expect(reset).toEqual(["C-1"]);
    expect((await getCase("C-1"))?.status).toBe("new");
  });

  it("setCaseStatus enforces the per-actor table inside the transaction", async () => {
    await seedCase("C-1", { status: "paid" });
    await expect(setCaseStatus("C-1", "needs_info", { actor: "agent", action: "x", reason: "x" })).rejects.toMatchObject({ code: "illegal_transition" });
    await seedCase("C-2", { status: "approved", humanDecision: { approved: true, by: "human:ops", at: Timestamp.now() } });
    await expect(setCaseStatus("C-2", "needs_review", { actor: "agent", action: "x", reason: "x" })).rejects.toMatchObject({ code: "human_override" });
    await expect(setCaseStatus("C-2", "parked", { actor: "agent", action: "x", reason: "x" })).resolves.toMatchObject({ status: "parked" });
    await expect(setCaseStatus("C-2", "rejected", { actor: "agent", action: "x", reason: "x" })).rejects.toMatchObject({ code: "agent_cannot_reject" });
    await expect(setCaseStatus("C-2", "rejected", { actor: "human:ops", action: "x", reason: "x" })).resolves.toMatchObject({ status: "rejected" });
  });
});
