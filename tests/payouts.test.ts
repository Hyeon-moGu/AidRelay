import { describe, expect, it } from "vitest";
import { WebhookEventSchema } from "@/lib/paypal/events";
import {
  buildPayoutRequest,
  infoFromBatchItem,
  outcomeForBatchStatus,
  outcomeForItemStatus,
  parsePayoutEvent,
} from "@/lib/paypal/payouts";

describe("buildPayoutRequest", () => {
  it("keys the batch on the per-instance id, the item on the case id, and formats cents as a decimal string", () => {
    const body = buildPayoutRequest({
      caseId: "C-001",
      senderBatchId: "C-001-9f3a1c2b",
      recipientEmail: "sb-r1@personal.example.com",
      amountCents: 25_000,
      currency: "USD",
      note: "Relief grant",
    });
    expect(body.sender_batch_header.sender_batch_id).toBe("C-001-9f3a1c2b");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      recipient_type: "EMAIL",
      receiver: "sb-r1@personal.example.com",
      amount: { value: "250.00", currency: "USD" },
      sender_item_id: "C-001",
    });
  });
});

describe("status mapping", () => {
  it("items", () => {
    expect(outcomeForItemStatus("SUCCESS")).toBe("paid");
    for (const s of ["FAILED", "BLOCKED", "CANCELED", "DENIED", "RETURNED", "REFUNDED", "REVERSED"]) {
      expect(outcomeForItemStatus(s)).toBe("failed");
    }
    for (const s of ["PENDING", "UNCLAIMED", "ONHOLD", "NEW"]) expect(outcomeForItemStatus(s)).toBe("pending");
  });
  it("batches never mark a case paid on their own", () => {
    expect(outcomeForBatchStatus("SUCCESS")).toBe("pending");
    expect(outcomeForBatchStatus("PROCESSING")).toBe("pending");
    expect(outcomeForBatchStatus("DENIED")).toBe("failed");
  });
});

describe("parsePayoutEvent", () => {
  const itemEvent = WebhookEventSchema.parse({
    id: "WH-ITEM-1",
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource_type: "payouts_item",
    resource: {
      payout_item_id: "G2SHAPEUDU4EJ",
      transaction_id: "2YV64236V9942562B",
      transaction_status: "SUCCESS",
      payout_batch_id: "QJ8WZ3ZGN8V5C",
      payout_item: {
        recipient_type: "EMAIL",
        amount: { value: "250.00", currency: "USD" },
        receiver: "sb-r1@personal.example.com",
        sender_item_id: "C-001",
        note: "Relief grant",
      },
      time_processed: "2026-11-07T09:00:00Z",
    },
  });

  it("maps an item event to its case", () => {
    expect(parsePayoutEvent(itemEvent)).toEqual({
      kind: "item",
      caseId: "C-001",
      payoutBatchId: "QJ8WZ3ZGN8V5C",
      status: "SUCCESS",
      outcome: "paid",
      transactionId: "2YV64236V9942562B",
      payoutItemId: "G2SHAPEUDU4EJ",
      amountCents: 25_000,
      currency: "USD",
      error: undefined,
    });
  });

  it("carries the error of a failed item", () => {
    const failed = WebhookEventSchema.parse({
      ...itemEvent,
      event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
      resource: {
        ...itemEvent.resource,
        transaction_status: "FAILED",
        errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
      },
    });
    expect(parsePayoutEvent(failed)).toMatchObject({ outcome: "failed", error: "Receiver is unregistered" });
  });

  it("maps a batch event to its sender_batch_id (the repo resolves the case)", () => {
    const batch = WebhookEventSchema.parse({
      id: "WH-BATCH-1",
      event_type: "PAYMENT.PAYOUTSBATCH.DENIED",
      resource: {
        batch_header: {
          payout_batch_id: "QJ8WZ3ZGN8V5C",
          batch_status: "DENIED",
          sender_batch_header: { sender_batch_id: "C-001-9f3a1c2b", email_subject: "x" },
        },
      },
    });
    expect(parsePayoutEvent(batch)).toEqual({
      kind: "batch",
      senderBatchId: "C-001-9f3a1c2b",
      payoutBatchId: "QJ8WZ3ZGN8V5C",
      status: "DENIED",
      outcome: "failed",
    });
  });

  it("ignores events that are not about payouts", () => {
    expect(parsePayoutEvent(WebhookEventSchema.parse({ id: "x", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} }))).toBeUndefined();
  });
});

describe("infoFromBatchItem (polling)", () => {
  it("carries both the item's case id and the batch's sender id", () => {
    const info = infoFromBatchItem(
      { batch_header: { payout_batch_id: "B1", batch_status: "SUCCESS", sender_batch_header: { sender_batch_id: "C-002-abcd1234" } } },
      { payout_item_id: "I1", transaction_status: "UNCLAIMED", payout_item: { amount: { value: "250.00", currency: "USD" }, receiver: "x@y", sender_item_id: "C-002" } },
    );
    expect(info).toMatchObject({ caseId: "C-002", senderBatchId: "C-002-abcd1234", payoutBatchId: "B1", status: "UNCLAIMED", outcome: "pending", amountCents: 25_000 });
  });
});
