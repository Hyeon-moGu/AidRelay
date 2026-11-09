// An operator sends again a payout PayPal did not accept. Against the in-memory Firestore fake with PayPal
// mocked: it is the same request (same sender_batch_id), the reservation never moves, a batch PayPal already
// holds is adopted rather than duplicated, and every state that is not "PayPal did not accept it" is refused.
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
import { createCase, getCase, setCaseStatus } from "@/lib/db/repos/cases";
import { getFund, releaseFunds, reserveFunds } from "@/lib/db/repos/fund";
import { applyPayoutEvent, createPayoutForCase, getPayout, payoutIsRetryable, retryFailedPayout, STALE_CREATING_MS } from "@/lib/db/repos/payouts";
import type { CaseDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, existingBatchIdFromError, getPayoutBatch, payoutNote } from "@/lib/paypal/payouts";

let db: FakeFirestore;
const OPS = "human:ops" as const;
const meta = { actor: "agent" as const, policyClause: "P-9.6", reason: "test" };
const accepted = (id: string, senderBatchId = "x") => ({ batch_header: { payout_batch_id: id, batch_status: "PENDING", sender_batch_header: { sender_batch_id: senderBatchId } } });
const serverError = () => new PayPalError("PayPal POST /v1/payments/payouts failed (500)", 500, { name: "INTERNAL_SERVICE_ERROR" });

/** A case approved by a volunteer whose payout PayPal answered with a 500: `create_failed`, money still reserved. */
async function failedPayout(): Promise<CaseDoc> {
  await getFund();
  await db.collection("fund").doc("default").update({ name: "Cedar County Flood Relief Fund", raisedCents: 100_000 });
  await createCase({
    id: "C-1",
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 35_000,
    narrative: "water in the kitchen",
    photos: [],
    docs: [],
    contact: { name: "A", email: "c-1@example.test" },
  });
  await db.collection("cases").doc("C-1").update({ status: "approved", tier: 3, approvedAmountCents: 35_000, humanDecision: { approved: true, by: OPS, amountCents: 35_000, at: Timestamp.now() } });
  await reserveFunds("C-1", 35_000, meta);
  vi.mocked(createPayout).mockRejectedValueOnce(serverError());
  await expect(
    createPayoutForCase({ caseId: "C-1", amountCents: 35_000, currency: "USD", recipientEmail: "c-1@example.test", note: payoutNote("Cedar County Flood Relief Fund", "C-1"), actor: "agent", policyClause: "human decision", reason: "human-approved payout", autoApproved: false }),
  ).rejects.toThrow();
  return (await getCase("C-1")) as CaseDoc;
}

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(createPayout).mockReset();
  vi.mocked(getPayoutBatch).mockReset();
});

describe("retryFailedPayout", () => {
  it("sends the same request again and moves the case to paying; the reservation never moves", async () => {
    const c = await failedPayout();
    expect(await getPayout("C-1")).toMatchObject({ status: "create_failed", outcome: "create_failed" });
    expect(c.status).toBe("approved");
    expect((await getFund()).reservedCents).toBe(35_000);

    vi.mocked(createPayout).mockResolvedValueOnce(accepted("B-9"));
    const payout = await retryFailedPayout("C-1", OPS);

    expect(payout).toMatchObject({ status: "PENDING", payoutBatchId: "B-9", outcome: "pending" });
    expect(payout).not.toHaveProperty("error");
    const [first, second] = vi.mocked(createPayout).mock.calls.map((call) => call[0]);
    expect(second).toEqual(first);
    expect(second.senderBatchId).toBe(`C-1-${c.token.slice(0, 8)}`);
    expect((await getCase("C-1"))?.status).toBe("paying");
    expect((await getCase("C-1"))?.payoutBatchId).toBe("B-9");
    expect((await getFund()).reservedCents).toBe(35_000);
    const audit = db.all("audit_log").find((a) => a.action === "payout.retry");
    expect(audit).toMatchObject({ actor: OPS, caseId: "C-1" });
  });

  it("settles like any other payout once PayPal pays it", async () => {
    await failedPayout();
    vi.mocked(createPayout).mockResolvedValueOnce(accepted("B-9"));
    await retryFailedPayout("C-1", OPS);
    await applyPayoutEvent({ kind: "item", caseId: "C-1", payoutBatchId: "B-9", status: "SUCCESS", outcome: "paid" }, "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    const f = await getFund();
    expect(f.paidCents).toBe(35_000);
    expect(f.reservedCents).toBe(0);
    expect((await getCase("C-1"))?.status).toBe("paid");
  });

  it("adopts the batch PayPal already holds instead of treating the duplicate as a failure", async () => {
    const c = await failedPayout();
    const senderBatchId = `C-1-${c.token.slice(0, 8)}`;
    vi.mocked(createPayout).mockRejectedValueOnce(
      new PayPalError("PayPal POST /v1/payments/payouts failed (400)", 400, {
        name: "USER_BUSINESS_ERROR",
        details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists", link: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/5UXD2E8A7EBQJ", rel: "self" }] }],
      }),
    );
    vi.mocked(getPayoutBatch).mockResolvedValue({
      batch_header: { payout_batch_id: "5UXD2E8A7EBQJ", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: senderBatchId } },
      items: [{ payout_item_id: "I-1", transaction_status: "SUCCESS", payout_item: { amount: { value: "350.00", currency: "USD" }, receiver: "c-1@example.test", sender_item_id: "C-1" } }],
    });

    const payout = await retryFailedPayout("C-1", OPS);
    expect(payout).toMatchObject({ payoutBatchId: "5UXD2E8A7EBQJ", outcome: "paid" });
    expect((await getCase("C-1"))?.status).toBe("paid");
    const f = await getFund();
    expect(f.paidCents).toBe(35_000);
    expect(f.reservedCents).toBe(0);
  });

  it("stays as it was when PayPal refuses again: create_failed, approved, money reserved", async () => {
    await failedPayout();
    vi.mocked(createPayout).mockRejectedValueOnce(serverError());
    await expect(retryFailedPayout("C-1", OPS)).rejects.toThrow(PayPalError);
    expect(await getPayout("C-1")).toMatchObject({ status: "create_failed", outcome: "create_failed" });
    expect((await getCase("C-1"))?.status).toBe("approved");
    expect((await getFund()).reservedCents).toBe(35_000);
  });

  it("refuses a payout PayPal accepted, a rejected case and a changed amount, without calling PayPal", async () => {
    await failedPayout();
    vi.mocked(createPayout).mockResolvedValueOnce(accepted("B-9"));
    await retryFailedPayout("C-1", OPS);
    await expect(retryFailedPayout("C-1", OPS)).rejects.toThrow(GuardrailError);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(2);

    db = new FakeFirestore();
    state.db = db;
    vi.mocked(createPayout).mockReset();
    await failedPayout();
    await releaseFunds("C-1", { actor: OPS, policyClause: "P-9.6", reason: "operator decision" });
    await setCaseStatus("C-1", "rejected", { actor: OPS, action: "case.human_rejected", reason: "rejected by operator" });
    await expect(retryFailedPayout("C-1", OPS)).rejects.toThrow(/rejected/);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(1);

    db = new FakeFirestore();
    state.db = db;
    vi.mocked(createPayout).mockReset();
    await failedPayout();
    await db.collection("cases").doc("C-1").update({ "humanDecision.amountCents": 40_000 });
    await expect(retryFailedPayout("C-1", OPS)).rejects.toThrow(/amount on file changed/);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(1);
  });

  it("takes the reservation again when a reopened case was approved once more", async () => {
    await failedPayout();
    await releaseFunds("C-1", { actor: OPS, policyClause: "P-9.6", reason: "operator decision" });
    expect((await getFund()).reservedCents).toBe(0);
    vi.mocked(createPayout).mockResolvedValueOnce(accepted("B-9"));
    await retryFailedPayout("C-1", OPS);
    expect((await getFund()).reservedCents).toBe(35_000);
    expect((await getCase("C-1"))?.status).toBe("paying");
  });

  it("covers a payout PayPal never answered, once the claim is old enough", async () => {
    await failedPayout();
    await db.collection("payouts").doc("C-1").update({ status: "creating", outcome: "pending", updatedAt: Timestamp.now() });
    await db.collection("cases").doc("C-1").update({ status: "paying" });
    await expect(retryFailedPayout("C-1", OPS)).rejects.toThrow(/creating/);

    await db.collection("payouts").doc("C-1").update({ updatedAt: Timestamp.fromMillis(Date.now() - STALE_CREATING_MS - 1_000) });
    vi.mocked(createPayout).mockResolvedValueOnce(accepted("B-9"));
    const payout = await retryFailedPayout("C-1", OPS);
    expect(payout).toMatchObject({ status: "PENDING", payoutBatchId: "B-9" });
    expect((await getCase("C-1"))?.status).toBe("paying");
  });
});

describe("payoutIsRetryable", () => {
  const at = (msAgo: number) => Timestamp.fromMillis(Date.now() - msAgo);
  it("is true only for a payout PayPal did not accept or never answered", () => {
    expect(payoutIsRetryable({ status: "create_failed", outcome: "create_failed", updatedAt: at(0) })).toBe(true);
    expect(payoutIsRetryable({ status: "creating", outcome: "pending", updatedAt: at(STALE_CREATING_MS + 1_000) })).toBe(true);
    expect(payoutIsRetryable({ status: "creating", outcome: "pending", updatedAt: at(5_000) })).toBe(false);
    expect(payoutIsRetryable({ status: "PENDING", outcome: "pending", updatedAt: at(600_000) })).toBe(false);
    expect(payoutIsRetryable({ status: "FAILED", outcome: "failed", updatedAt: at(600_000) })).toBe(false);
    expect(payoutIsRetryable({ status: "SUCCESS", outcome: "paid", updatedAt: at(600_000) })).toBe(false);
  });
});

describe("existingBatchIdFromError", () => {
  it("reads the batch id from PayPal's duplicate sender_batch_id refusal, and nothing from other errors", () => {
    expect(
      existingBatchIdFromError({
        name: "USER_BUSINESS_ERROR",
        details: [{ field: "SENDER_BATCH_ID", issue: "Batch with given sender_batch_id already exists", link: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/5UXD2E8A7EBQJ", rel: "self" }] }],
      }),
    ).toBe("5UXD2E8A7EBQJ");
    expect(existingBatchIdFromError({ name: "INSUFFICIENT_FUNDS", message: "Sender does not have sufficient funds.", information_link: "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors" })).toBeUndefined();
    expect(existingBatchIdFromError({ name: "INTERNAL_SERVICE_ERROR" })).toBeUndefined();
    expect(existingBatchIdFromError(null)).toBeUndefined();
  });
});
