// Races around one payout, against the Firestore fake whose transactions retry on contention: a PayPal call
// that answers late, PayPal's webhooks, and operators clicking "Send payout again". Money must never be paid
// twice, and the fund's totals must match what PayPal did.
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

import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund, reserveFunds } from "@/lib/db/repos/fund";
import { applyPayoutEvent, createPayoutForCase, getPayout, payoutIsRetryable, retryFailedPayout, STALE_CREATING_MS } from "@/lib/db/repos/payouts";
import { fundBalanceCents, type CaseDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, getPayoutBatch, payoutNote, type PayoutBatch } from "@/lib/paypal/payouts";

let db: OccFirestore;
const OPS = "human:ops" as const;
const meta = { actor: "agent" as const, policyClause: "P-9.6", reason: "test" };
const AMOUNT = 35_000;

const batch = (id: string, senderBatchId: string, status = "PENDING"): PayoutBatch => ({ batch_header: { payout_batch_id: id, batch_status: status, sender_batch_header: { sender_batch_id: senderBatchId } } });
const succeeded = (batchId: string) => ({ kind: "item" as const, caseId: "C-1", payoutBatchId: batchId, status: "SUCCESS", outcome: "paid" as const });
const timeout = () => Object.assign(new TypeError("fetch failed"), { cause: new Error("Headers Timeout Error") });

async function approvedCase(): Promise<CaseDoc> {
  await getFund();
  await db.collection("fund").doc("default").update({ name: "Relief Fund", raisedCents: 100_000 });
  await createCase({ id: "C-1", lang: "en", zip: "28501", householdSize: 3, requestedAmountCents: AMOUNT, narrative: "water", photos: [], docs: [], contact: { name: "A", email: "c-1@example.test" } });
  await db.collection("cases").doc("C-1").update({ status: "approved", tier: 3, approvedAmountCents: AMOUNT, humanDecision: { approved: true, by: OPS, amountCents: AMOUNT, at: Timestamp.now() } });
  await reserveFunds("C-1", AMOUNT, meta);
  return (await getCase("C-1")) as CaseDoc;
}

const firstAttempt = () =>
  createPayoutForCase({ caseId: "C-1", amountCents: AMOUNT, currency: "USD", recipientEmail: "c-1@example.test", note: payoutNote("Relief Fund", "C-1"), actor: "agent", policyClause: "human decision", reason: "human-approved payout", autoApproved: false });

async function totals() {
  const f = await getFund();
  return { raised: f.raisedCents, paid: f.paidCents, reserved: f.reservedCents, balance: fundBalanceCents(f) };
}

beforeEach(() => {
  db = new OccFirestore();
  state.db = db;
  vi.mocked(createPayout).mockReset();
  vi.mocked(getPayoutBatch).mockReset();
});

describe("a PayPal answer that arrives after the webhook", () => {
  it("does not overwrite a payout the SUCCESS webhook already settled", async () => {
    await approvedCase();
    // PayPal accepted the batch and paid the item, but our HTTP call died before its answer arrived
    // (Node's fetch gives up on response headers after 300 s; the webhook comes within seconds).
    vi.mocked(createPayout).mockImplementationOnce(async () => {
      await applyPayoutEvent(succeeded("B-1"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
      throw timeout();
    });
    await firstAttempt().catch(() => undefined);

    expect((await getCase("C-1"))?.status).toBe("paid");
    expect(await totals()).toMatchObject({ paid: AMOUNT, reserved: 0 });
    const p = await getPayout("C-1");
    // The payout record must still say what PayPal said: paid, not "PayPal did not accept it".
    expect(p).toMatchObject({ outcome: "paid" });
    expect(payoutIsRetryable(p!)).toBe(false);
  });

  it("a refund after that still takes the money out of paidCents", async () => {
    await approvedCase();
    vi.mocked(createPayout).mockImplementationOnce(async () => {
      await applyPayoutEvent(succeeded("B-1"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
      throw timeout();
    });
    await firstAttempt().catch(() => undefined);
    await applyPayoutEvent({ kind: "item", caseId: "C-1", payoutBatchId: "B-1", status: "REFUNDED", outcome: "failed" }, "webhook", "PAYMENT.PAYOUTS-ITEM.REFUNDED");
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    // The money came back to the fund's PayPal account: the ledger must not still count it as paid.
    expect(await totals()).toMatchObject({ paid: 0, reserved: 0, balance: 100_000 });
  });
});

describe("Send payout again, raced", () => {
  it("two operators clicking at once make one PayPal call", async () => {
    const c = await approvedCase();
    vi.mocked(createPayout).mockRejectedValueOnce(new PayPalError("PayPal POST /v1/payments/payouts failed (500)", 500, { name: "INTERNAL_SERVICE_ERROR" }));
    await firstAttempt().catch(() => undefined);
    vi.mocked(createPayout).mockResolvedValue(batch("B-9", `C-1-${c.token.slice(0, 8)}`));

    const results = await Promise.allSettled([retryFailedPayout("C-1", OPS), retryFailedPayout("C-1", OPS)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(vi.mocked(createPayout)).toHaveBeenCalledTimes(2); // the first attempt + one retry
    expect(await totals()).toMatchObject({ reserved: AMOUNT, paid: 0 });
  });

  it("after a reopen and a fresh approval, two clicks reserve once", async () => {
    const c = await approvedCase();
    vi.mocked(createPayout).mockRejectedValueOnce(new PayPalError("PayPal POST /v1/payments/payouts failed (500)", 500, { name: "INTERNAL_SERVICE_ERROR" }));
    await firstAttempt().catch(() => undefined);
    const { applyHumanDecision } = await import("@/lib/ops/decide");
    await applyHumanDecision({ action: "reopen", caseIds: ["C-1"] }).catch(() => undefined);
    expect(await totals()).toMatchObject({ reserved: 0 });
    await db.collection("cases").doc("C-1").update({ status: "approved", humanDecision: { approved: true, by: OPS, amountCents: AMOUNT, at: Timestamp.now() } });
    vi.mocked(createPayout).mockResolvedValue(batch("B-9", `C-1-${c.token.slice(0, 8)}`));
    await Promise.allSettled([retryFailedPayout("C-1", OPS), retryFailedPayout("C-1", OPS)]);
    expect(await totals()).toMatchObject({ reserved: AMOUNT, paid: 0, balance: 100_000 - AMOUNT });
  });

  it("a stale 'creating' retry while the first call is still waiting: the late failure does not undo the retry", async () => {
    const c = await approvedCase();
    const senderBatchId = `C-1-${c.token.slice(0, 8)}`;
    let failFirst!: (e: unknown) => void;
    vi.mocked(createPayout).mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)));
    const first = firstAttempt().catch((e) => e);
    await vi.waitFor(() => expect(failFirst).toBeDefined());
    // Two minutes later the operator sees the case stuck in `paying` and sends the payout again.
    await db.collection("payouts").doc("C-1").update({ updatedAt: Timestamp.fromMillis(Date.now() - STALE_CREATING_MS - 1_000) });
    vi.mocked(createPayout).mockResolvedValueOnce(batch("B-1", senderBatchId));
    await retryFailedPayout("C-1", OPS);
    expect((await getCase("C-1"))?.status).toBe("paying");
    expect(await getPayout("C-1")).toMatchObject({ status: "PENDING", payoutBatchId: "B-1" });

    // Now the first call gives up.
    failFirst(timeout());
    await first;
    // PayPal holds batch B-1 for this case: the record and the case must still say so.
    expect(await getPayout("C-1")).toMatchObject({ payoutBatchId: "B-1", outcome: "pending" });
    expect((await getCase("C-1"))?.status).toBe("paying");
  });

  it("a case whose retry went through cannot be rejected while PayPal pays it, and the payment is recorded", async () => {
    const c = await approvedCase();
    const senderBatchId = `C-1-${c.token.slice(0, 8)}`;
    let failFirst!: (e: unknown) => void;
    vi.mocked(createPayout).mockImplementationOnce(() => new Promise((_, reject) => (failFirst = reject)));
    const first = firstAttempt().catch((e) => e);
    await vi.waitFor(() => expect(failFirst).toBeDefined());
    await db.collection("payouts").doc("C-1").update({ updatedAt: Timestamp.fromMillis(Date.now() - STALE_CREATING_MS - 1_000) });
    vi.mocked(createPayout).mockResolvedValueOnce(batch("B-1", senderBatchId));
    await retryFailedPayout("C-1", OPS);
    failFirst(timeout());
    await first;

    // The case is still `paying`, so a volunteer cannot reject it and free its money.
    const { applyHumanDecision } = await import("@/lib/ops/decide");
    const rejected = await applyHumanDecision({ action: "reject", caseIds: ["C-1"] });
    expect(rejected.results[0].ok).toBe(false);
    await applyPayoutEvent(succeeded("B-1"), "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect((await getCase("C-1"))?.status).toBe("paid");
    expect(await totals()).toMatchObject({ paid: AMOUNT, reserved: 0, balance: 100_000 - AMOUNT });
  });
});
