// PayPal Orders v2 — donations in. Server-only.
import { randomUUID } from "node:crypto";
import { centsToValue } from "@/lib/money";
import { paypalFetch } from "@/lib/paypal/client";

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export interface PayPalCapture {
  id: string;
  status: string; // COMPLETED | PENDING | DECLINED | FAILED | REFUNDED | PARTIALLY_REFUNDED
  amount: PayPalAmount;
  custom_id?: string;
  create_time?: string;
  update_time?: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
}

export interface PayPalOrder {
  id: string;
  status: string; // CREATED | SAVED | APPROVED | VOIDED | COMPLETED | PAYER_ACTION_REQUIRED
  payer?: { email_address?: string; payer_id?: string };
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: PayPalAmount;
    payments?: { captures?: PayPalCapture[] };
  }>;
}

export interface CreateDonationOrderInput {
  amountCents: number;
  currency: string;
  fundId: string;
  description: string;
}

/** Creates a CAPTURE-intent order for a donation. The JS SDK button takes the returned id through approval. */
export async function createDonationOrder(input: CreateDonationOrderInput): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    requestId: `order-${randomUUID()}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "donation",
          custom_id: input.fundId,
          description: input.description,
          amount: { currency_code: input.currency, value: centsToValue(input.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            brand_name: "AidRelay (sandbox)",
          },
        },
      },
    },
  });
}

/** Captures an approved order. Idempotent per order through `PayPal-Request-Id`. */
export async function captureOrder(orderId: string): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    requestId: `capture-${orderId}`,
    body: {},
  });
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Capture details; used by the webhook handler when the event does not carry the order id. */
export async function getCapture(captureId: string): Promise<PayPalCapture> {
  return paypalFetch<PayPalCapture>(`/v2/payments/captures/${encodeURIComponent(captureId)}`);
}

export function extractCapture(order: PayPalOrder): PayPalCapture | undefined {
  return order.purchase_units?.[0]?.payments?.captures?.[0];
}
