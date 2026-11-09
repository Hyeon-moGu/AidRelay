import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { assertAgentStatusWrite } from "@/lib/agent/guardrails";
import { assertTransition } from "@/lib/agent/transitions";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx, writeAudit } from "@/lib/db/repos/audit";
import { releaseFunds, reversePaid, settlePaid } from "@/lib/db/repos/fund";
import { setCaseStatus } from "@/lib/db/repos/cases";
import type { AuditActor, CaseDoc, PayoutDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, getPayoutBatch, infoFromBatchItem, type PayoutEventInfo } from "@/lib/paypal/payouts";

export async function getPayout(caseId: string): Promise<PayoutDoc | undefined> {
  const snap = await getDb().collection(col.payouts).doc(caseId).get();
  return snap.exists ? (snap.data() as PayoutDoc) : undefined;
}

export async function getPayoutBySenderBatchId(senderBatchId: string): Promise<PayoutDoc | undefined> {
  const snap = await getDb().collection(col.payouts).where("senderBatchId", "==", senderBatchId).limit(1).get();
  return snap.empty ? undefined : (snap.docs[0].data() as PayoutDoc);
}

/** Unique per case instance (the token is minted per application), so reseeds never reuse a PayPal idempotency key. */
export function senderBatchIdFor(c: Pick<CaseDoc, "id" | "token">): string {
  return `${c.id}-${c.token.slice(0, 8)}`;
}

export interface CreatePayoutArgs {
  caseId: string;
  amountCents: number;
  currency: string;
  recipientEmail: string;
  note: string;
  actor: AuditActor;
  policyClause: string;
  reason: string;
  /** No human approved it: recorded in auto_approvals inside the claim transaction (P-10). */
  autoApproved: boolean;
}

/**
 * The only path that calls PayPal Payouts. Caller must already have passed guardrails.assertPayable.
 * Step 1 (transaction): claim payouts/{caseId}, fails if any payout exists for the case, move the case
 * to `paying`, and (P-10) record the auto approval. Step 2: PayPal. Step 3 (transaction): record the batch
 * id without clobbering a status a fast webhook may already have written. A crash between 1 and 2 leaves a
 * `creating` record that blocks a second attempt until a human reconciles it (never two payouts).
 */
export async function createPayoutForCase(args: CreatePayoutArgs): Promise<PayoutDoc> {
  if (args.actor === "agent") assertAgentStatusWrite("paying");
  const db = getDb();
  const pRef = db.collection(col.payouts).doc(args.caseId);
  const cRef = db.collection(col.cases).doc(args.caseId);
  const now = Timestamp.now();

  const claimed = await db.runTransaction(async (tx) => {
    const [pSnap, cSnap] = await Promise.all([tx.get(pRef), tx.get(cRef)]);
    if (pSnap.exists) throw new Error(`payout already exists for ${args.caseId} (status ${(pSnap.data() as PayoutDoc).status})`);
    if (!cSnap.exists) throw new Error(`case ${args.caseId} not found`);
    const c = cSnap.data() as CaseDoc;
    if (c.status !== "approved") throw new Error(`case ${args.caseId} is ${c.status}, not approved`);
    assertTransition(args.actor, c.status, "paying", { humanApproved: !!c.humanDecision?.approved });
    if ((c.reservedCents ?? 0) !== args.amountCents) {
      throw new Error(`case ${args.caseId} has ${c.reservedCents ?? 0} reserved, payout asks ${args.amountCents}`);
    }
    const doc: PayoutDoc = {
      caseId: args.caseId,
      senderBatchId: senderBatchIdFor(c),
      amountCents: args.amountCents,
      currency: args.currency,
      recipientEmail: args.recipientEmail,
      status: "creating",
      outcome: "pending",
      autoApproved: args.autoApproved,
      events: [{ type: "create.requested", source: "api", at: now }],
      createdAt: now,
      updatedAt: now,
    };
    tx.create(pRef, doc);
    tx.update(cRef, { status: "paying" });
    if (args.autoApproved) {
      tx.set(db.collection(col.autoApprovals).doc(args.caseId), { caseId: args.caseId, amountCents: args.amountCents, at: now });
    }
    auditInTx(tx, {
      actor: args.actor,
      caseId: args.caseId,
      action: "payout.create",
      policyClause: args.policyClause,
      before: { status: "approved" },
      after: { status: "paying", amountCents: args.amountCents, senderBatchId: doc.senderBatchId },
      reason: args.reason,
    });
    return doc;
  });

  try {
    const batch = await createPayout({
      caseId: args.caseId,
      senderBatchId: claimed.senderBatchId,
      recipientEmail: args.recipientEmail,
      amountCents: args.amountCents,
      currency: args.currency,
      note: args.note,
    });
    const header = batch.batch_header;
    // Conditional: a PAYOUTS-ITEM.SUCCEEDED webhook may have settled the case while PayPal was answering.
    const stored = await db.runTransaction(async (tx) => {
      const snap = await tx.get(pRef);
      const cur = snap.data() as PayoutDoc;
      const patch: Record<string, unknown> = {
        payoutBatchId: header.payout_batch_id,
        batchStatus: header.batch_status,
        updatedAt: Timestamp.now(),
        events: FieldValue.arrayUnion({ type: "create.accepted", status: header.batch_status, source: "api", at: Timestamp.now() }),
      };
      if (cur.status === "creating") patch.status = header.batch_status;
      tx.update(pRef, patch);
      return { ...cur, ...patch, events: cur.events } as PayoutDoc;
    });
    await cRef.update({ payoutBatchId: header.payout_batch_id });
    await writeAudit({
      actor: args.actor,
      caseId: args.caseId,
      action: "payout.accepted",
      policyClause: args.policyClause,
      after: { payoutBatchId: header.payout_batch_id, batchStatus: header.batch_status },
      reason: `PayPal accepted batch ${header.payout_batch_id}`,
      refs: { payoutBatchId: header.payout_batch_id },
    });
    return stored;
  } catch (err) {
    const message = err instanceof PayPalError ? `${err.message} ${JSON.stringify(err.body)}` : err instanceof Error ? err.message : String(err);
    await pRef.update({
      status: "create_failed",
      outcome: "create_failed",
      error: message.slice(0, 1000),
      updatedAt: Timestamp.now(),
      events: FieldValue.arrayUnion({ type: "create.failed", source: "api", at: Timestamp.now() }),
    });
    // Reservation is kept; the case goes back to approved. A human clears the record after checking PayPal
    // (a timed-out call may still have created the batch, its webhooks reconcile through applyPayoutEvent).
    await setCaseStatus(args.caseId, "approved", {
      actor: "system",
      action: "payout.create_failed",
      reason: message.slice(0, 300),
      policyClause: args.policyClause,
    });
    throw err;
  }
}

export interface ApplyResult {
  caseId?: string;
  outcome: PayoutEventInfo["outcome"];
  changed: boolean;
  note?: string;
}

/**
 * Applies a payout status (from a webhook or a poll) to the payout record, the case and the fund.
 * Idempotent, and provenance-checked: an event for another batch (another environment on the same
 * sandbox app, or an unrelated payout) is audited and ignored.
 */
export async function applyPayoutEvent(info: PayoutEventInfo, source: "webhook" | "poll", eventType: string): Promise<ApplyResult> {
  const db = getDb();
  let payout = info.caseId ? await getPayout(info.caseId) : undefined;
  if (!payout && info.senderBatchId) payout = await getPayoutBySenderBatchId(info.senderBatchId);
  if (!payout) return { caseId: info.caseId, outcome: info.outcome, changed: false, note: "no payout record for this event" };
  const caseId = payout.caseId;

  const foreign =
    (info.payoutBatchId && payout.payoutBatchId && info.payoutBatchId !== payout.payoutBatchId) ||
    (info.senderBatchId && info.senderBatchId !== payout.senderBatchId);
  if (foreign) {
    await writeAudit({
      actor: "system",
      caseId,
      action: "payout.event_ignored",
      reason: `${eventType} for batch ${info.payoutBatchId ?? info.senderBatchId} does not belong to this case's batch ${payout.payoutBatchId ?? payout.senderBatchId}`,
    });
    return { caseId, outcome: info.outcome, changed: false, note: "event belongs to another batch; ignored" };
  }

  const pRef = db.collection(col.payouts).doc(caseId);
  const patch: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
    events: FieldValue.arrayUnion({ type: eventType, status: info.status, source, at: Timestamp.now() }),
  };
  if (info.payoutBatchId && !payout.payoutBatchId) patch.payoutBatchId = info.payoutBatchId;
  if (info.kind === "batch") {
    patch.batchStatus = info.status;
  } else {
    patch.status = info.status;
    if (info.payoutItemId) patch.payoutItemId = info.payoutItemId;
    if (info.transactionId) patch.transactionId = info.transactionId;
    if (info.error) patch.error = info.error;
  }
  await pRef.update(patch);
  const batchId = info.payoutBatchId ?? payout.payoutBatchId;

  if (info.outcome === "paid") {
    if (payout.outcome === "paid") return { caseId, outcome: "paid", changed: false };
    await pRef.update({ outcome: "paid" });
    const { changed } = await settlePaid(caseId, payout.amountCents, {
      actor: "system",
      reason: `PayPal ${eventType}: item ${info.status}`,
      policyClause: "P-9",
      payoutBatchId: batchId,
    });
    return { caseId, outcome: "paid", changed };
  }

  if (info.outcome === "failed") {
    if (payout.outcome === "failed" || payout.outcome === "reversed") return { caseId, outcome: "failed", changed: false };
    if (payout.outcome === "paid") {
      await pRef.update({ outcome: "reversed" });
      const { changed } = await reversePaid(caseId, payout.amountCents, {
        actor: "system",
        reason: `PayPal ${eventType}: ${info.status}${info.error ? ` (${info.error})` : ""} after SUCCESS; money returned to the fund`,
        policyClause: "P-9",
        payoutBatchId: batchId,
      });
      return { caseId, outcome: "failed", changed, note: "paid payout reversed" };
    }
    await pRef.update({ outcome: "failed" });
    await releaseFunds(
      caseId,
      { actor: "system", reason: `PayPal ${eventType}: ${info.status}${info.error ? ` (${info.error})` : ""}`, policyClause: "P-9.6" },
      { afterFailedPayout: true },
    );
    await setCaseStatus(caseId, "needs_review", {
      actor: "system",
      action: "payout.failed",
      reason: `payout ${info.status}${info.error ? `: ${info.error}` : ""}; a human must re-issue or contact the applicant`,
      policyClause: "P-9",
    });
    return { caseId, outcome: "failed", changed: true };
  }

  return { caseId, outcome: "pending", changed: false, note: `recorded ${info.status}` };
}

/** Polls PayPal for the batch and applies every item. Used by get_payout_status and the sweep backstop. */
export async function refreshPayoutStatus(caseId: string): Promise<{ payout: PayoutDoc | undefined; applied: Array<{ status: string; outcome: string; changed: boolean }> }> {
  const payout = await getPayout(caseId);
  if (!payout?.payoutBatchId) return { payout, applied: [] };
  const batch = await getPayoutBatch(payout.payoutBatchId);
  const applied: Array<{ status: string; outcome: string; changed: boolean }> = [];
  for (const item of batch.items ?? []) {
    const info = infoFromBatchItem(batch, item);
    if ((info.caseId ?? caseId) !== caseId) continue;
    const r = await applyPayoutEvent({ ...info, caseId }, "poll", "poll.item");
    applied.push({ status: info.status, outcome: r.outcome, changed: r.changed });
  }
  return { payout: await getPayout(caseId), applied };
}
