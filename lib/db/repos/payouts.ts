import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { assertAgentStatusWrite } from "@/lib/agent/guardrails";
import { assertTransition } from "@/lib/agent/transitions";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx, writeAudit } from "@/lib/db/repos/audit";
import { releaseFunds, settlePaid } from "@/lib/db/repos/fund";
import { setCaseStatus } from "@/lib/db/repos/cases";
import type { AuditActor, CaseDoc, PayoutDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, getPayoutBatch, infoFromBatchItem, type PayoutEventInfo } from "@/lib/paypal/payouts";

export async function getPayout(caseId: string): Promise<PayoutDoc | undefined> {
  const snap = await getDb().collection(col.payouts).doc(caseId).get();
  return snap.exists ? (snap.data() as PayoutDoc) : undefined;
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
}

/**
 * The only path that calls PayPal Payouts. Caller must already have passed guardrails.assertPayable.
 * Step 1 (transaction): claim payouts/{caseId} — fails if any payout exists for the case — and move the
 * case to `paying`. Step 2: PayPal. Step 3: record the batch id. A crash between 1 and 2 leaves a
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
      senderBatchId: args.caseId,
      amountCents: args.amountCents,
      currency: args.currency,
      recipientEmail: args.recipientEmail,
      status: "creating",
      outcome: "pending",
      events: [{ type: "create.requested", source: "api", at: now }],
      createdAt: now,
      updatedAt: now,
    };
    tx.create(pRef, doc);
    tx.update(cRef, { status: "paying" });
    auditInTx(tx, {
      actor: args.actor,
      caseId: args.caseId,
      action: "payout.create",
      policyClause: args.policyClause,
      before: { status: "approved" },
      after: { status: "paying", amountCents: args.amountCents },
      reason: args.reason,
    });
    return doc;
  });

  try {
    const batch = await createPayout({
      caseId: args.caseId,
      recipientEmail: args.recipientEmail,
      amountCents: args.amountCents,
      currency: args.currency,
      note: args.note,
    });
    const header = batch.batch_header;
    const patch = {
      payoutBatchId: header.payout_batch_id,
      status: header.batch_status,
      updatedAt: Timestamp.now(),
      events: FieldValue.arrayUnion({ type: "create.accepted", status: header.batch_status, source: "api", at: Timestamp.now() }),
    };
    await pRef.update(patch);
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
    return { ...claimed, payoutBatchId: header.payout_batch_id, status: header.batch_status };
  } catch (err) {
    const message = err instanceof PayPalError ? `${err.message} ${JSON.stringify(err.body)}` : err instanceof Error ? err.message : String(err);
    await pRef.update({
      status: "create_failed",
      outcome: "failed",
      error: message.slice(0, 1000),
      updatedAt: Timestamp.now(),
      events: FieldValue.arrayUnion({ type: "create.failed", source: "api", at: Timestamp.now() }),
    });
    // Reservation is kept; the case goes back to approved so a human (or the sweep) can retry after a fix.
    await setCaseStatus(args.caseId, "approved", {
      actor: "system",
      action: "payout.create_failed",
      reason: message.slice(0, 300),
      policyClause: args.policyClause,
    });
    throw err;
  }
}

/**
 * Applies a payout status (from a webhook or a poll) to the payout record, the case and the fund.
 * Idempotent: a paid case stays paid, a released reservation is not released twice.
 */
export async function applyPayoutEvent(info: PayoutEventInfo, source: "webhook" | "poll", eventType: string): Promise<{ outcome: PayoutEventInfo["outcome"]; changed: boolean; note?: string }> {
  const db = getDb();
  const pRef = db.collection(col.payouts).doc(info.caseId);
  const pSnap = await pRef.get();
  if (!pSnap.exists) return { outcome: info.outcome, changed: false, note: `no payout record for ${info.caseId}` };
  const payout = pSnap.data() as PayoutDoc;

  await pRef.update({
    status: info.status,
    ...(info.payoutBatchId ? { payoutBatchId: info.payoutBatchId } : {}),
    ...(info.payoutItemId ? { payoutItemId: info.payoutItemId } : {}),
    ...(info.transactionId ? { transactionId: info.transactionId } : {}),
    ...(info.error ? { error: info.error } : {}),
    updatedAt: Timestamp.now(),
    events: FieldValue.arrayUnion({ type: eventType, status: info.status, source, at: Timestamp.now() }),
  });

  if (info.outcome === "paid") {
    if (payout.outcome === "paid") return { outcome: "paid", changed: false };
    await pRef.update({ outcome: "paid" });
    const { changed } = await settlePaid(info.caseId, payout.amountCents, {
      actor: "system",
      reason: `PayPal ${eventType}: item ${info.status}`,
      policyClause: "P-9",
      payoutBatchId: info.payoutBatchId ?? payout.payoutBatchId,
    });
    return { outcome: "paid", changed };
  }

  if (info.outcome === "failed") {
    if (payout.outcome === "failed") return { outcome: "failed", changed: false };
    await pRef.update({ outcome: "failed" });
    await releaseFunds(
      info.caseId,
      {
        actor: "system",
        reason: `PayPal ${eventType}: ${info.status}${info.error ? ` (${info.error})` : ""}`,
        policyClause: "P-9.6",
      },
      { afterFailedPayout: true },
    );
    await setCaseStatus(info.caseId, "needs_review", {
      actor: "system",
      action: "payout.failed",
      reason: `payout ${info.status}${info.error ? `: ${info.error}` : ""}; a human must re-issue or contact the applicant`,
      policyClause: "P-9",
    });
    return { outcome: "failed", changed: true };
  }

  return { outcome: "pending", changed: false, note: `recorded ${info.status}` };
}

/** Polls PayPal for the batch and applies every item. Used by get_payout_status and as a webhook fallback. */
export async function refreshPayoutStatus(caseId: string): Promise<{ payout: PayoutDoc | undefined; applied: Array<{ status: string; outcome: string }> }> {
  const payout = await getPayout(caseId);
  if (!payout?.payoutBatchId) return { payout, applied: [] };
  const batch = await getPayoutBatch(payout.payoutBatchId);
  const applied: Array<{ status: string; outcome: string }> = [];
  for (const item of batch.items ?? []) {
    const info = infoFromBatchItem(batch, item);
    if (!info || info.caseId !== caseId) continue;
    const r = await applyPayoutEvent(info, "poll", "poll.item");
    applied.push({ status: info.status, outcome: r.outcome });
  }
  return { payout: await getPayout(caseId), applied };
}
