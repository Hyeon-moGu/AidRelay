import { describe, expect, it } from "vitest";
import {
  isCaptureEvent,
  isPayoutEvent,
  parseCaptureEvent,
  WebhookEventSchema,
} from "@/lib/paypal/events";

const captureCompleted = {
  id: "WH-58D329510W468432D-8HN650336L201105X",
  event_version: "1.0",
  create_time: "2026-11-07T08:15:00.000Z",
  resource_type: "capture",
  resource_version: "2.0",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  summary: "Payment completed for $ 20.0 USD",
  resource: {
    id: "3C679366HH908993F",
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "20.00" },
    custom_id: "default",
    final_capture: true,
    seller_protection: { status: "ELIGIBLE" },
    supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
    payee: { email_address: "sb-fund@business.example.com" },
    create_time: "2026-11-07T08:14:58Z",
  },
};

describe("WebhookEventSchema", () => {
  it("accepts a real-shaped event and keeps unknown fields", () => {
    const parsed = WebhookEventSchema.parse(captureCompleted);
    expect(parsed.id).toBe(captureCompleted.id);
    expect((parsed as Record<string, unknown>).event_version).toBe("1.0");
  });

  it("rejects an event without an id", () => {
    const { id: _omit, ...noId } = captureCompleted;
    void _omit;
    expect(WebhookEventSchema.safeParse(noId).success).toBe(false);
  });
});

describe("parseCaptureEvent", () => {
  it("extracts capture id, order id, cents and currency", () => {
    expect(parseCaptureEvent(WebhookEventSchema.parse(captureCompleted))).toEqual({
      captureId: "3C679366HH908993F",
      orderId: "5O190127TN364715T",
      status: "COMPLETED",
      amountCents: 2000,
      currency: "USD",
      customId: "default",
    });
  });

  it("tolerates a missing order id (the handler then looks the capture up)", () => {
    const event = WebhookEventSchema.parse({
      ...captureCompleted,
      resource: { ...captureCompleted.resource, supplementary_data: undefined },
    });
    expect(parseCaptureEvent(event).orderId).toBeUndefined();
  });

  it("throws when the resource is not a capture", () => {
    const event = WebhookEventSchema.parse({ ...captureCompleted, resource: { id: "x" } });
    expect(() => parseCaptureEvent(event)).toThrow();
  });
});

describe("event classification", () => {
  it("separates capture events from payout events", () => {
    expect(isCaptureEvent("PAYMENT.CAPTURE.COMPLETED")).toBe(true);
    expect(isPayoutEvent("PAYMENT.CAPTURE.COMPLETED")).toBe(false);
    expect(isPayoutEvent("PAYMENT.PAYOUTSBATCH.SUCCESS")).toBe(true);
    expect(isPayoutEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED")).toBe(true);
    expect(isCaptureEvent("CHECKOUT.ORDER.APPROVED")).toBe(false);
  });
});
