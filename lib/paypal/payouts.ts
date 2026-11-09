// PayPal Payouts v1, cash out. Server-only.
// sender_batch_id is unique per case INSTANCE (`${caseId}-${token prefix}`), so a reseeded case id never
// collides with PayPal's 30-day idempotency window; sender_item_id stays the case id for event routing.
import { z } from "zod";
import { centsToValue, valueToCents } from "@/lib/money";
import { paypalFetch } from "@/lib/paypal/client";
import type { WebhookEvent } from "@/lib/paypal/events";

export interface PayoutRequestInput {
  caseId: string;
  /** Unique per case instance. PayPal refuses a second batch with a sender_batch_id it saw in the last 30 days. */
  senderBatchId: string;
  recipientEmail: string;
  amountCents: number;
  currency: string;
  /** Shown to the recipient. No PII, no case details beyond what they already know. */
  note: string;
}

/** Pure: the exact body sent to POST /v1/payments/payouts. */
export function buildPayoutRequest(input: PayoutRequestInput) {
  return {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: "You have received a relief grant",
      email_message: input.note,
    },
    items: [
      {
        recipient_type: "EMAIL",
        receiver: input.recipientEmail,
        amount: { value: centsToValue(input.amountCents), currency: input.currency },
        note: input.note,
        sender_item_id: input.caseId,
      },
    ],
  };
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: string; // PENDING | PROCESSING | SUCCESS | DENIED | CANCELED
  sender_batch_header: { sender_batch_id: string; email_subject?: string };
  time_created?: string;
  time_completed?: string;
}

export interface PayoutItemDetail {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status: string;
  payout_item: {
    recipient_type?: string;
    amount: { value: string; currency: string };
    receiver: string;
    sender_item_id?: string;
    note?: string;
  };
  errors?: { name?: string; message?: string };
  time_processed?: string;
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items?: PayoutItemDetail[];
}

/**
 * `attemptId` makes the PayPal-Request-Id: the same for the automatic re-send inside one attempt (a 401 with
 * a stale token), new for each attempt an operator starts, so PayPal never answers a retry with the stored
 * response of the attempt that failed. A second batch is still impossible: that is what sender_batch_id is for.
 */
export async function createPayout(input: PayoutRequestInput, attemptId: string): Promise<PayoutBatch> {
  return paypalFetch<PayoutBatch>("/v1/payments/payouts", {
    method: "POST",
    requestId: `payout-${input.senderBatchId}-${attemptId}`,
    body: buildPayoutRequest(input),
  });
}

export async function getPayoutBatch(payoutBatchId: string): Promise<PayoutBatch> {
  return paypalFetch<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
}

/** What the recipient reads. Built in one place so a retry sends PayPal the same request as the first attempt. */
export function payoutNote(fundName: string, caseId: string): string {
  return `Relief grant from ${fundName}. Reference ${caseId}.`;
}

/**
 * PayPal refuses a second batch with a sender_batch_id it has already seen ("Batch with given
 * sender_batch_id already exists"): the first attempt created the batch after all.
 */
export function isDuplicateBatchError(body: unknown): boolean {
  const text = JSON.stringify(body ?? "");
  return /already exists/i.test(text) && /sender_batch_id/i.test(text);
}

/** The existing batch's id, when that refusal links to it; a retry then adopts the batch. */
export function existingBatchIdFromError(body: unknown): string | undefined {
  if (!isDuplicateBatchError(body)) return undefined;
  return /\/v1\/payments\/payouts\/([A-Z0-9]{6,})/.exec(JSON.stringify(body))?.[1];
}

export type PayoutOutcome = "paid" | "failed" | "pending";

/** Item transaction_status → what it means for the case. UNCLAIMED stays pending (PayPal holds it ~30 days, then RETURNED). */
export function outcomeForItemStatus(status: string): PayoutOutcome {
  switch (status.toUpperCase()) {
    case "SUCCESS":
      return "paid";
    case "FAILED":
    case "BLOCKED":
    case "CANCELED":
    case "DENIED":
    case "RETURNED":
    case "REFUNDED":
    case "REVERSED":
      return "failed";
    default:
      return "pending"; // NEW, PENDING, UNCLAIMED, ONHOLD
  }
}

export function outcomeForBatchStatus(status: string): PayoutOutcome {
  switch (status.toUpperCase()) {
    case "DENIED":
    case "CANCELED":
      return "failed";
    default:
      return "pending"; // PENDING, PROCESSING, SUCCESS, the item event carries the per-case truth
  }
}

export interface PayoutEventInfo {
  kind: "item" | "batch";
  /** From sender_item_id (item events). Batch events carry only senderBatchId; the repo resolves the case. */
  caseId?: string;
  senderBatchId?: string;
  payoutBatchId?: string;
  status: string;
  outcome: PayoutOutcome;
  transactionId?: string;
  payoutItemId?: string;
  amountCents?: number;
  currency?: string;
  error?: string;
}

const ItemResource = z
  .object({
    payout_item_id: z.string(),
    transaction_id: z.string().optional(),
    transaction_status: z.string(),
    payout_batch_id: z.string().optional(),
    payout_item: z
      .object({
        amount: z.object({ value: z.string(), currency: z.string() }).optional(),
        sender_item_id: z.string().optional(),
      })
      .loose(),
    errors: z.object({ name: z.string().optional(), message: z.string().optional() }).loose().optional(),
  })
  .loose();

const BatchResource = z
  .object({
    batch_header: z
      .object({
        payout_batch_id: z.string(),
        batch_status: z.string(),
        sender_batch_header: z.object({ sender_batch_id: z.string() }).loose(),
      })
      .loose(),
  })
  .loose();

/** Pure: maps PAYMENT.PAYOUTS-ITEM.* / PAYMENT.PAYOUTSBATCH.* events to the case / batch they concern. */
export function parsePayoutEvent(event: WebhookEvent): PayoutEventInfo | undefined {
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const r = ItemResource.safeParse(event.resource);
    if (!r.success || !r.data.payout_item.sender_item_id) return undefined;
    const amount = r.data.payout_item.amount;
    return {
      kind: "item",
      caseId: r.data.payout_item.sender_item_id,
      payoutBatchId: r.data.payout_batch_id,
      status: r.data.transaction_status,
      outcome: outcomeForItemStatus(r.data.transaction_status),
      transactionId: r.data.transaction_id,
      payoutItemId: r.data.payout_item_id,
      amountCents: amount ? valueToCents(amount.value) : undefined,
      currency: amount?.currency,
      error: r.data.errors?.message ?? r.data.errors?.name,
    };
  }
  if (event.event_type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const r = BatchResource.safeParse(event.resource);
    if (!r.success) return undefined;
    const h = r.data.batch_header;
    return {
      kind: "batch",
      senderBatchId: h.sender_batch_header.sender_batch_id,
      payoutBatchId: h.payout_batch_id,
      status: h.batch_status,
      outcome: outcomeForBatchStatus(h.batch_status),
    };
  }
  return undefined;
}

/** Pure: the same mapping for items returned by GET /v1/payments/payouts/{id}. */
export function infoFromBatchItem(batch: PayoutBatch, item: PayoutItemDetail): PayoutEventInfo {
  return {
    kind: "item",
    caseId: item.payout_item.sender_item_id,
    senderBatchId: batch.batch_header.sender_batch_header.sender_batch_id,
    payoutBatchId: batch.batch_header.payout_batch_id,
    status: item.transaction_status,
    outcome: outcomeForItemStatus(item.transaction_status),
    transactionId: item.transaction_id,
    payoutItemId: item.payout_item_id,
    amountCents: valueToCents(item.payout_item.amount.value),
    currency: item.payout_item.amount.currency,
    error: item.errors?.message ?? item.errors?.name,
  };
}
