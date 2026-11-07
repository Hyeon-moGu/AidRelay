// Pure parsers for PayPal webhook events. No I/O, so they are unit-tested without credentials.
import { z } from "zod";
import { valueToCents } from "@/lib/money";

export const WebhookEventSchema = z
  .object({
    id: z.string().min(1),
    event_type: z.string().min(1),
    create_time: z.string().optional(),
    resource_type: z.string().optional(),
    summary: z.string().optional(),
    resource: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

const CaptureResourceSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    amount: z.object({ currency_code: z.string().length(3), value: z.string() }),
    custom_id: z.string().optional(),
    supplementary_data: z
      .object({ related_ids: z.object({ order_id: z.string().optional() }).loose().optional() })
      .loose()
      .optional(),
  })
  .loose();

export interface CaptureCompleted {
  captureId: string;
  orderId?: string;
  status: string;
  amountCents: number;
  currency: string;
  /** `purchase_units[].custom_id`, AidRelay sets it to the fund id. */
  customId?: string;
}

/** Parses a PAYMENT.CAPTURE.* event's resource. Throws if the shape is not a capture. */
export function parseCaptureEvent(event: WebhookEvent): CaptureCompleted {
  const r = CaptureResourceSchema.parse(event.resource);
  return {
    captureId: r.id,
    orderId: r.supplementary_data?.related_ids?.order_id,
    status: r.status,
    amountCents: valueToCents(r.amount.value),
    currency: r.amount.currency_code,
    customId: r.custom_id,
  };
}

export const CAPTURE_EVENT_TYPES = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
] as const;

export const PAYOUT_EVENT_TYPES = [
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
] as const;

export function isCaptureEvent(type: string): boolean {
  return type.startsWith("PAYMENT.CAPTURE.");
}

export function isPayoutEvent(type: string): boolean {
  return type.startsWith("PAYMENT.PAYOUTSBATCH.") || type.startsWith("PAYMENT.PAYOUTS-ITEM.");
}
