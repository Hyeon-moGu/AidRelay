// Money-in checks money-routes.test.ts leaves out: PayPal answering for another order, and a capture that is known
// only by the fund's custom_id (no order record), in the fund's currency and in another one. PayPal is mocked.
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

describe("money in, provenance edges", () => {
  const order = (id: string, currency: string, value: string) => ({
    id,
    status: "COMPLETED",
    purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, status: "COMPLETED", amount: { currency_code: currency, value } }] } }],
  });

  it("capture-order refuses an answer about another order and counts nothing", async () => {
    await createDonationRecord({ orderId: "O-1", amountCents: 2_000, currency: "USD" });
    vi.mocked(captureOrder).mockResolvedValueOnce(order("O-OTHER", "USD", "20.00") as never);
    const res = await captureRoute(new Request("http://test/api/donate/capture-order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: "O-1" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.any(String) });
    expect((await getFund()).raisedCents).toBe(0);
  });

  it("the webhook counts a capture known only by the fund's custom_id, in the fund's currency", async () => {
    const res = await webhookRoute(webhook(captureEvent("WH-C1", "O-NO-RECORD", "default")));
    expect(res.status).toBe(200);
    expect((await getFund()).raisedCents).toBe(2_000);
  });

  it("the webhook ignores a capture known only by custom_id when it is in another currency", async () => {
    const event = captureEvent("WH-C2", "O-NO-RECORD-2", "default");
    event.resource.amount.currency_code = "EUR";
    expect((await webhookRoute(webhook(event))).status).toBe(200);
    expect((await getFund()).raisedCents).toBe(0);
  });
});
