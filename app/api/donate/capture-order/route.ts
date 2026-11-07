import { z } from "zod";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { recordDonationCapture } from "@/lib/db/repos/donations";
import { HttpError, handleRouteError, ok, parseJson } from "@/lib/http";
import { stripPii } from "@/lib/ledger/anonymize";
import { valueToCents } from "@/lib/money";
import { PayPalError } from "@/lib/paypal/client";
import { captureOrder, extractCapture, getOrder, type PayPalOrder } from "@/lib/paypal/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ orderId: z.string().min(1).max(64) });

async function captureOrFetch(orderId: string): Promise<PayPalOrder> {
  try {
    return await captureOrder(orderId);
  } catch (err) {
    // A retry after a lost response: PayPal answers 422 ORDER_ALREADY_CAPTURED; the order itself holds the capture.
    if (err instanceof PayPalError && err.status === 422 && issueOf(err.body) === "ORDER_ALREADY_CAPTURED") {
      return getOrder(orderId);
    }
    throw err;
  }
}

function issueOf(body: unknown): string | undefined {
  const details = (body as { details?: Array<{ issue?: string }> } | null)?.details;
  return details?.[0]?.issue;
}

export async function POST(req: Request) {
  try {
    const { orderId } = await parseJson(req, Body);
    const order = await captureOrFetch(orderId);
    const capture = extractCapture(order);
    if (!capture) throw new HttpError(502, `PayPal returned order status ${order.status} without a capture`);

    const amountCents = valueToCents(capture.amount.value);
    const result = await recordDonationCapture({
      orderId,
      captureId: capture.id,
      captureStatus: capture.status,
      amountCents,
      currency: capture.amount.currency_code,
      payerEmail: order.payer?.email_address,
      raw: stripPii(order) as unknown as Record<string, unknown>,
      source: "api",
    });
    if (result.applied) enqueueAgentRun({ trigger: "donation.captured", orderId });

    return ok({
      orderId,
      captureId: capture.id,
      status: capture.status,
      amountCents,
      applied: result.applied,
      raisedCents: result.raisedCents,
    });
  } catch (err) {
    return handleRouteError(err, "donate/capture-order");
  }
}
