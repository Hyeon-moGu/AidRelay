import { Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/db/firestore";
import type { WebhookEventDoc } from "@/lib/db/types";
import { stripPii } from "@/lib/ledger/anonymize";
import type { WebhookEvent } from "@/lib/paypal/events";

export type ClaimResult = "new" | "retry" | "duplicate";

/**
 * Claims an event id for processing. "duplicate" means it was already handled
 * (PayPal retries deliveries); "retry" means an earlier attempt failed before marking it handled.
 */
export async function claimWebhookEvent(event: WebhookEvent): Promise<ClaimResult> {
  const ref = getDb().collection(col.webhookEvents).doc(event.id);
  const doc: WebhookEventDoc = {
    id: event.id,
    eventType: event.event_type,
    resourceType: event.resource_type,
    summary: event.summary,
    createTime: event.create_time,
    receivedAt: Timestamp.now(),
    handled: false,
    event: stripPii(event) as Record<string, unknown>,
  };
  try {
    await ref.create(doc);
    return "new";
  } catch {
    const existing = (await ref.get()).data() as WebhookEventDoc | undefined;
    return existing?.handled ? "duplicate" : "retry";
  }
}

export async function markWebhookHandled(eventId: string, outcome: Record<string, unknown>): Promise<void> {
  await getDb()
    .collection(col.webhookEvents)
    .doc(eventId)
    .update({ handled: true, handledAt: Timestamp.now(), outcome });
}
