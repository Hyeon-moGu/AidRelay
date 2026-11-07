// PayPal webhook receiver: verify signature → claim event id → handle → mark handled.
// PayPal retries any non-2xx response, so an event is only marked handled once its side effects committed.
// Payout events are reconciled INLINE (deterministic, no model) so a lost self-call can never lose `paid`.
import { runCaseOfficer } from "@/lib/agent/officer";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { getDonation, recordDonationCapture } from "@/lib/db/repos/donations";
import { claimWebhookEvent, markWebhookHandled } from "@/lib/db/repos/webhookEvents";
import { getEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { stripPii } from "@/lib/ledger/anonymize";
import {
  isCaptureEvent,
  isPayoutEvent,
  parseCaptureEvent,
  WebhookEventSchema,
  type WebhookEvent,
} from "@/lib/paypal/events";
import { getCapture } from "@/lib/paypal/orders";
import { readWebhookHeaders, verifyWebhookSignature, webhookConfigured } from "@/lib/paypal/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!webhookConfigured()) return fail("webhook not configured: set PAYPAL_WEBHOOK_ID", 503);
  const rawBody = await req.text();
  const headers = readWebhookHeaders(req.headers);
  if (!headers) return fail("missing PayPal signature headers", 400);

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(headers, rawBody);
  } catch (err) {
    console.error("[webhook] verification call failed", err);
    return fail("verification unavailable", 502);
  }
  if (!verified) return fail("invalid signature", 400);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return fail("body is not JSON", 400);
  }
  const parsed = WebhookEventSchema.safeParse(json);
  if (!parsed.success) return fail("malformed event", 400);
  const event = parsed.data;

  const claim = await claimWebhookEvent(event);
  if (claim === "duplicate") return ok({ eventId: event.id, duplicate: true });

  try {
    const outcome = await handleEvent(event);
    await markWebhookHandled(event.id, outcome);
    return ok({ eventId: event.id, ...outcome });
  } catch (err) {
    console.error(`[webhook] ${event.event_type} ${event.id} failed`, err);
    return fail("handler failed; PayPal will retry", 500);
  }
}

async function handleEvent(event: WebhookEvent): Promise<Record<string, unknown>> {
  const type = event.event_type;

  if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const capture = parseCaptureEvent(event);
    const orderId =
      capture.orderId ?? (await getCapture(capture.captureId)).supplementary_data?.related_ids?.order_id;
    if (!orderId) return { type, skipped: "capture carries no order id" };

    // Provenance: only orders this app created, or captures tagged with this fund (custom_id), count as donations.
    const known = await getDonation(orderId);
    if (!known && capture.customId !== getEnv().FUND_ID) {
      return { type, orderId, ignored: `capture for an unknown order (custom_id ${capture.customId ?? "none"})` };
    }

    const result = await recordDonationCapture({
      orderId,
      captureId: capture.captureId,
      captureStatus: capture.status,
      amountCents: capture.amountCents,
      currency: capture.currency,
      raw: stripPii(event.resource ?? {}),
      source: "webhook",
    });
    if (result.applied) enqueueAgentRun({ trigger: "donation.captured", orderId, eventId: event.id });
    return { type, orderId, applied: result.applied, raisedCents: result.raisedCents };
  }

  if (isCaptureEvent(type)) {
    const capture = parseCaptureEvent(event);
    return { type, captureId: capture.captureId, status: capture.status, note: "recorded, no fund change" };
  }

  if (isPayoutEvent(type)) {
    // Inline and awaited: the money state must be settled before PayPal hears 200.
    const run = await runCaseOfficer({ trigger: "payout.webhook", eventId: event.id });
    return { type, runId: run.runId, summary: run.summary };
  }

  return { type, ignored: true };
}
