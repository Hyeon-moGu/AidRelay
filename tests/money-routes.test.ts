// Route-level checks on the two ways money enters the fund: the PayPal webhook and the capture call from /donate.
// PayPal is mocked; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, verified: true }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), PAYPAL_WEBHOOK_ID: "WH-TEST" }) };
});
vi.mock("@/lib/paypal/webhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/webhooks")>();
  return { ...actual, verifyWebhookSignature: vi.fn(async () => state.verified) };
});
vi.mock("@/lib/paypal/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/orders")>();
  return { ...actual, captureOrder: vi.fn(), getOrder: vi.fn(), getCapture: vi.fn() };
});
vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});
vi.mock("@/lib/agent/officer", () => ({ runCaseOfficer: vi.fn() }));

import { POST as captureRoute } from "@/app/api/donate/capture-order/route";
import { POST as webhookRoute } from "@/app/api/webhooks/paypal/route";
import { runCaseOfficer } from "@/lib/agent/officer";
import { createDonationRecord } from "@/lib/db/repos/donations";
import { getFund } from "@/lib/db/repos/fund";
import { getWebhookEvent } from "@/lib/db/repos/webhookEvents";
import { captureOrder } from "@/lib/paypal/orders";

let db: FakeFirestore;

const SIG = {
  "paypal-transmission-id": "t-1",
  "paypal-transmission-time": "2026-11-09T00:00:00Z",
  "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-transmission-sig": "sig",
};

function webhook(body: object, headers: Record<string, string> = SIG): Request {
  return new Request("http://test/api/webhooks/paypal", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const captureEvent = (id: string, orderId: string, customId?: string) => ({
  id,
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: `CAP-${id}`, status: "COMPLETED", amount: { currency_code: "USD", value: "20.00" }, ...(customId ? { custom_id: customId } : {}), supplementary_data: { related_ids: { order_id: orderId } } },
});

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  state.verified = true;
  vi.mocked(runCaseOfficer).mockReset();
  vi.mocked(captureOrder).mockReset();
  await getFund();
});

describe("POST /api/webhooks/paypal", () => {
  it("a bad signature is refused before anything is claimed or counted", async () => {
    state.verified = false;
    const res = await webhookRoute(webhook(captureEvent("WH-1", "O-1", "default")));
    expect(res.status).toBe(400);
    expect(await getWebhookEvent("WH-1")).toBeUndefined();
    expect((await getFund()).raisedCents).toBe(0);
  });

  it("missing signature headers answer 400 in the { ok, error } shape", async () => {
    const res = await webhookRoute(webhook(captureEvent("WH-2", "O-2", "default"), {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("a capture for an order this fund never created, without its custom_id, is ignored", async () => {
    const res = await webhookRoute(webhook(captureEvent("WH-3", "O-FOREIGN")));
    expect(res.status).toBe(200);
    expect((await getFund()).raisedCents).toBe(0);
  });

  it("counts a known order once, and a redelivery is a no-op", async () => {
    await createDonationRecord({ orderId: "O-4", amountCents: 2_000, currency: "USD" });
    expect((await webhookRoute(webhook(captureEvent("WH-4", "O-4")))).status).toBe(200);
    expect((await webhookRoute(webhook(captureEvent("WH-4", "O-4")))).status).toBe(200);
    expect((await getFund()).raisedCents).toBe(2_000);
    expect((await getWebhookEvent("WH-4"))?.handled).toBe(true);
  });

  it("a payout event whose reconciliation fails answers 500 and stays unhandled, so PayPal redelivers it", async () => {
    vi.mocked(runCaseOfficer).mockRejectedValueOnce(new Error("firestore unavailable"));
    const res = await webhookRoute(webhook({ id: "WH-5", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: {} }));
    expect(res.status).toBe(500);
    expect((await getWebhookEvent("WH-5"))?.handled).toBe(false);
  });
});

describe("POST /api/donate/capture-order", () => {
  const post = (orderId: string) => captureRoute(new Request("http://test/api/donate/capture-order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) }));
  const order = (id: string, currency: string, value: string) => ({
    id,
    status: "COMPLETED",
    purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, status: "COMPLETED", amount: { currency_code: currency, value } }] } }],
  });

  it("counts a USD capture of an order /donate created", async () => {
    await createDonationRecord({ orderId: "O-USD", amountCents: 2_000, currency: "USD" });
    vi.mocked(captureOrder).mockResolvedValueOnce(order("O-USD", "USD", "20.00") as never);
    expect((await post("O-USD")).status).toBe(200);
    expect((await getFund()).raisedCents).toBe(2_000);
  });

  it("never counts a capture in another currency as US cents (raisedCents is USD)", async () => {
    vi.mocked(captureOrder).mockResolvedValueOnce(order("O-JPY", "JPY", "2000") as never);
    await post("O-JPY");
    expect((await getFund()).raisedCents, "¥2,000 must not become $2,000").toBe(0);
  });

  it("refuses a known order whose capture comes back in another currency", async () => {
    await createDonationRecord({ orderId: "O-MIX", amountCents: 2_000, currency: "USD" });
    vi.mocked(captureOrder).mockResolvedValueOnce(order("O-MIX", "JPY", "2000") as never);
    expect((await post("O-MIX")).status).toBe(502);
    expect((await getFund()).raisedCents).toBe(0);
  });

  it("captures only an order /donate created: an unknown id, or another spelling of a known one, never reaches PayPal", async () => {
    await createDonationRecord({ orderId: "5O190127TN364715T", amountCents: 2_000, currency: "USD" });
    vi.mocked(captureOrder).mockResolvedValue(order("5O190127TN364715T", "USD", "20.00") as never);
    expect((await post("5o190127tn364715t")).status).toBe(404);
    expect((await post("NOT-AN-ORDER")).status).toBe(404);
    expect(captureOrder).not.toHaveBeenCalled();
    expect((await post("5O190127TN364715T")).status).toBe(200);
    expect((await post("5O190127TN364715T")).status).toBe(200);
    expect((await getFund()).raisedCents, "one $20 donation, counted once").toBe(2_000);
  });
});

describe("POST /api/webhooks/paypal, currency", () => {
  it("ignores a capture in another currency than the fund's", async () => {
    await createDonationRecord({ orderId: "O-EUR", amountCents: 2_000, currency: "USD" });
    const event = captureEvent("WH-EUR", "O-EUR");
    event.resource.amount.currency_code = "EUR";
    expect((await webhookRoute(webhook(event))).status).toBe(200);
    expect((await getFund()).raisedCents).toBe(0);
  });
});
