// applyPayoutEvent commits the money state first and marks the payout's outcome after it. The outcome is
// what turns PayPal's redelivery of an event into a no-op, so if a money transaction fails once (Firestore
// ABORTED, an instance stopped mid-request) the redelivery must still settle or release the case.
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
vi.mock("@/lib/db/repos/fund", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos/fund")>();
  return { ...actual, settlePaid: vi.fn(actual.settlePaid), releaseFunds: vi.fn(actual.releaseFunds) };
});

import { createCase, getCase } from "@/lib/db/repos/cases";
import { getFund, releaseFunds, reserveFunds, settlePaid } from "@/lib/db/repos/fund";
import { applyPayoutEvent, createPayoutForCase } from "@/lib/db/repos/payouts";
import { createPayout } from "@/lib/paypal/payouts";

let db: FakeFirestore;
const meta = { actor: "agent" as const, policyClause: "P-9.6", reason: "test" };

async function payingCase() {
  await getFund();
  await db.collection("fund").doc("default").update({ raisedCents: 100_000 });
  await createCase({ id: "C-1", lang: "en", zip: "28501", householdSize: 3, requestedAmountCents: 25_000, narrative: "water", photos: [], docs: [], contact: { name: "A", email: "c-1@example.test" } });
  await db.collection("cases").doc("C-1").update({ status: "approved", tier: 2, approvedAmountCents: 25_000 });
  await reserveFunds("C-1", 25_000, meta);
  vi.mocked(createPayout).mockResolvedValueOnce({ batch_header: { payout_batch_id: "B-1", batch_status: "PENDING", sender_batch_header: { sender_batch_id: "x" } } });
  await createPayoutForCase({ caseId: "C-1", amountCents: 25_000, currency: "USD", recipientEmail: "c-1@example.test", note: "n", actor: "agent", policyClause: "P-9", reason: "auto", autoApproved: true });
}

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(settlePaid).mockClear();
  vi.mocked(releaseFunds).mockClear();
});

describe("a money transaction that fails once while applying a payout event", () => {
  it("SUCCESS: PayPal's redelivery still settles the case", async () => {
    await payingCase();
    const success = { kind: "item" as const, caseId: "C-1", payoutBatchId: "B-1", status: "SUCCESS", outcome: "paid" as const };
    vi.mocked(settlePaid).mockRejectedValueOnce(new Error("10 ABORTED: Too much contention on these documents."));
    await expect(applyPayoutEvent(success, "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).rejects.toThrow(/ABORTED/);
    // The webhook route answered 500; PayPal delivers the same event again.
    await applyPayoutEvent(success, "webhook", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect((await getCase("C-1"))?.status).toBe("paid");
    expect((await getFund()).paidCents).toBe(25_000);
  });

  it("FAILED: PayPal's redelivery still releases the reservation and hands the case to a human", async () => {
    await payingCase();
    const failed = { kind: "item" as const, caseId: "C-1", payoutBatchId: "B-1", status: "FAILED", outcome: "failed" as const };
    vi.mocked(releaseFunds).mockRejectedValueOnce(new Error("10 ABORTED: Too much contention on these documents."));
    await expect(applyPayoutEvent(failed, "webhook", "PAYMENT.PAYOUTS-ITEM.FAILED")).rejects.toThrow(/ABORTED/);
    await applyPayoutEvent(failed, "webhook", "PAYMENT.PAYOUTS-ITEM.FAILED");
    expect((await getCase("C-1"))?.status).toBe("needs_review");
    expect((await getFund()).reservedCents).toBe(0);
  });
});
