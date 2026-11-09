import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { assertAgentStatusWrite, GuardrailError } from "@/lib/agent/guardrails";
import { assertTransition } from "@/lib/agent/transitions";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx, writeAudit } from "@/lib/db/repos/audit";
import { getFund, releaseFunds, reserveFunds, reversePaid, settlePaid } from "@/lib/db/repos/fund";
import { getCase, setCaseStatus } from "@/lib/db/repos/cases";
import { amountForCase, type AuditActor, type CaseDoc, type PayoutDoc } from "@/lib/db/types";
import { PayPalError } from "@/lib/paypal/client";
import { createPayout, existingBatchIdFromError, getPayoutBatch, infoFromBatchItem, isDuplicateBatchError, payoutNote, type PayoutBatch, type PayoutEventInfo } from "@/lib/paypal/payouts";

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
 * `creating` record that blocks a second attempt (never two payouts) until an operator sends the same
 * request again from the console (`retryFailedPayout`).
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
    const doc: ClaimedPayout = {
      caseId: args.caseId,
      attemptId: randomUUID(),
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

  return (await sendClaimedPayout(claimed, { note: args.note, actor: args.actor, policyClause: args.policyClause })).payout;
}

interface SendArgs {
  note: string;
  actor: AuditActor;
  policyClause: string;
  /**
   * A retry of a request PayPal may already have processed: if PayPal answers that a batch with this
   * sender_batch_id exists, that batch is adopted instead of treating the answer as a failure.
   */
  adoptExistingBatch?: boolean;
}

/** A payout record held by one attempt: the first send, or an operator's retry. */
type ClaimedPayout = PayoutDoc & { attemptId: string };

/**
 * Steps 2 and 3 for a claimed payout (the record is `creating`, the case `paying`): the PayPal call, then
 * the batch id. While PayPal is answering, the record may move on: a webhook can record the item's status
 * (the batch exists, perhaps already paid), and an operator's retry can take the record over. So a failed
 * call is written to the record only by the attempt that still owns it (`recordFailedAttempt`); from
 * `create_failed` only an operator's retry (`retryFailedPayout`) sends it again.
 */
async function sendClaimedPayout(claimed: ClaimedPayout, args: SendArgs): Promise<{ payout: PayoutDoc; adopted: boolean }> {
  const db = getDb();
  const pRef = db.collection(col.payouts).doc(claimed.caseId);
  const cRef = db.collection(col.cases).doc(claimed.caseId);

  // The batch PayPal holds for this case. Undefined only when PayPal says one exists without naming it.
  let batch: PayoutBatch | undefined;
  let adopted = false;
  try {
    try {
      batch = await createPayout(
        {
          caseId: claimed.caseId,
          senderBatchId: claimed.senderBatchId,
          recipientEmail: claimed.recipientEmail,
          amountCents: claimed.amountCents,
          currency: claimed.currency,
          note: args.note,
        },
        claimed.attemptId,
      );
    } catch (err) {
      if (!(args.adoptExistingBatch && err instanceof PayPalError && isDuplicateBatchError(err.body))) throw err;
      // PayPal already holds a batch with this sender_batch_id: an earlier attempt went through after all.
      const existingId = existingBatchIdFromError(err.body);
      if (existingId) {
        batch = await getPayoutBatch(existingId);
        if (batch.batch_header.sender_batch_header.sender_batch_id !== claimed.senderBatchId) {
          throw new Error(`PayPal pointed at batch ${existingId}, which belongs to another sender_batch_id`);
        }
      }
      adopted = true;
    }
  } catch (err) {
    await recordFailedAttempt(claimed, args, err);
    throw err;
  }

  // PayPal has the batch. From here a failure to record it must not mark the payout failed: the record
  // stays as it is and the batch's webhooks carry its status (applyPayoutEvent).
  const header = batch?.batch_header;
  const now = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const [pSnap, cSnap] = await Promise.all([tx.get(pRef), tx.get(cRef)]);
    const cur = pSnap.data() as PayoutDoc;
    const c = cSnap.data() as CaseDoc | undefined;
    const patch: Record<string, unknown> = {
      updatedAt: now,
      events: FieldValue.arrayUnion({ type: adopted ? "create.adopted" : "create.accepted", status: header?.batch_status ?? "PENDING", source: "api", at: now }),
    };
    if (header) {
      patch.payoutBatchId = header.payout_batch_id;
      patch.batchStatus = header.batch_status;
    }
    // A webhook may already have written the item's status (even SUCCESS): that is newer than this answer.
    // `create_failed` here means a later attempt failed while this one went through: PayPal's yes wins.
    const awaitingAnswer = cur.status === "creating" || cur.status === "create_failed";
    if (awaitingAnswer) patch.status = header?.batch_status ?? "PENDING";
    if (cur.status === "create_failed") {
      patch.outcome = "pending";
      patch.error = FieldValue.delete();
    }
    tx.update(pRef, patch);
    if (c) {
      const casePatch: Record<string, unknown> = header ? { payoutBatchId: header.payout_batch_id } : {};
      if (cur.status === "create_failed" && c.status === "approved") {
        assertTransition("system", c.status, "paying");
        casePatch.status = "paying";
      }
      if (Object.keys(casePatch).length > 0) tx.update(cRef, casePatch);
    }
  });
  await writeAudit({
    actor: args.actor,
    caseId: claimed.caseId,
    action: "payout.accepted",
    policyClause: args.policyClause,
    after: header ? { payoutBatchId: header.payout_batch_id, batchStatus: header.batch_status } : { batchStatus: "held by PayPal, id not yet known" },
    reason: !header
      ? "PayPal already holds a batch for this case; its webhooks will carry the id and the status"
      : adopted
        ? `PayPal already held batch ${header.payout_batch_id} for this case; adopted it`
        : `PayPal accepted batch ${header.payout_batch_id}`,
    refs: header ? { payoutBatchId: header.payout_batch_id } : undefined,
  });
  return { payout: (await getPayout(claimed.caseId)) as PayoutDoc, adopted };
}

/**
 * PayPal did not accept the request (or did not answer in time). Only the attempt that still owns a
 * `creating` record may say so: then the record becomes `create_failed` and, in the same transaction, the
 * case returns to `approved` with its reservation. If a webhook already recorded the item's status, or an
 * operator's retry took the record over, this failure is only noted in the record's events.
 */
async function recordFailedAttempt(claimed: ClaimedPayout, args: SendArgs, err: unknown): Promise<void> {
  const db = getDb();
  const pRef = db.collection(col.payouts).doc(claimed.caseId);
  const cRef = db.collection(col.cases).doc(claimed.caseId);
  const message = err instanceof PayPalError ? `${err.message} ${JSON.stringify(err.body)}` : err instanceof Error ? err.message : String(err);
  const now = Timestamp.now();
  await db.runTransaction(async (tx) => {
    const [pSnap, cSnap] = await Promise.all([tx.get(pRef), tx.get(cRef)]);
    if (!pSnap.exists) return;
    const cur = pSnap.data() as PayoutDoc;
    if (cur.status !== "creating" || cur.attemptId !== claimed.attemptId) {
      tx.update(pRef, { events: FieldValue.arrayUnion({ type: "create.failed_late", source: "api", at: now }) });
      return;
    }
    tx.update(pRef, {
      status: "create_failed",
      outcome: "create_failed",
      error: message.slice(0, 1000),
      updatedAt: now,
      events: FieldValue.arrayUnion({ type: "create.failed", source: "api", at: now }),
    });
    // Reservation is kept; the case goes back to approved. The agent never sends it again on its own: an
    // operator does, from the console (a call that timed out may still have created the batch; its
    // webhooks reconcile through applyPayoutEvent, and the retry adopts that batch instead of creating another).
    const c = cSnap.data() as CaseDoc | undefined;
    if (c?.status === "paying") {
      assertTransition("system", c.status, "approved");
      tx.update(cRef, { status: "approved" });
      auditInTx(tx, {
        actor: "system",
        caseId: claimed.caseId,
        action: "payout.create_failed",
        policyClause: args.policyClause,
        before: { status: "paying" },
        after: { status: "approved" },
        reason: message.slice(0, 300),
      });
    }
  });
}

/**
 * A `creating` record this old was never answered: the process died between the claim and PayPal's reply.
 * Well above the longest an attempt can last (a token request, the call, and one re-send with a fresh
 * token, each cut off after PAYPAL_TIMEOUT_MS), so a retry never overlaps a call that is still waiting.
 */
export const STALE_CREATING_MS = 5 * 60_000;

/** Whether an operator may send this payout again: PayPal did not accept it, or never answered. */
export function payoutIsRetryable(p: Pick<PayoutDoc, "status" | "outcome" | "updatedAt">, nowMs = Date.now()): boolean {
  if (p.status === "create_failed" && p.outcome === "create_failed") return true;
  return p.status === "creating" && nowMs - p.updatedAt.toMillis() >= STALE_CREATING_MS;
}

/**
 * An operator sends again a payout PayPal did not accept (or never answered). It is the same payout: the
 * same sender_batch_id, recipient and amount, so PayPal either creates the batch now or reports the one an
 * earlier attempt created, and the case can never be paid twice.
 * Refused when the payout is in any other state, when the case is no longer waiting to be paid, or when
 * the amount on file has changed since the attempt that failed.
 */
export async function retryFailedPayout(caseId: string, actor: AuditActor): Promise<PayoutDoc> {
  const db = getDb();
  const pRef = db.collection(col.payouts).doc(caseId);
  const cRef = db.collection(col.cases).doc(caseId);

  // A reopened and re-approved case has lost its reservation: take it again first (never overdraws).
  const [before, failed] = await Promise.all([cRef.get(), pRef.get()]);
  if (before.exists && failed.exists) {
    const c = before.data() as CaseDoc;
    const p = failed.data() as PayoutDoc;
    if (p.status === "create_failed" && c.status === "approved" && amountForCase(c) === p.amountCents && (c.reservedCents ?? 0) !== p.amountCents) {
      await reserveFunds(caseId, p.amountCents, { actor, policyClause: "P-9.6", reason: `reserve ${p.amountCents} before sending the payout again` });
    }
  }

  const fund = await getFund();
  const now = Timestamp.now();
  const claimed = await db.runTransaction(async (tx) => {
    const [pSnap, cSnap] = await Promise.all([tx.get(pRef), tx.get(cRef)]);
    if (!pSnap.exists) throw new GuardrailError("prior_payout", `no payout was ever attempted for ${caseId}`, "P-9.7");
    if (!cSnap.exists) throw new Error(`case ${caseId} not found`);
    const p = pSnap.data() as PayoutDoc;
    const c = cSnap.data() as CaseDoc;
    if (!payoutIsRetryable(p, now.toMillis())) {
      throw new GuardrailError("prior_payout", `this payout is ${p.status}: only a payout PayPal did not accept, or never answered, can be sent again`, "P-9.7");
    }
    // After a refusal the case is back at `approved`; a payout PayPal never answered left it at `paying`.
    const expected = p.status === "create_failed" ? "approved" : "paying";
    if (c.status !== expected) throw new GuardrailError("status_not_payable", `case ${caseId} is ${c.status}; its payout cannot be sent again`, "P-9");
    if (amountForCase(c) !== p.amountCents) {
      throw new GuardrailError("bad_amount", `the amount on file changed since the payout of ${p.amountCents} cents failed; set it back or reject the case`, "P-7");
    }
    if ((c.reservedCents ?? 0) !== p.amountCents) {
      throw new GuardrailError("insufficient_funds", `case ${caseId} has ${c.reservedCents ?? 0} reserved, the payout needs ${p.amountCents}`, "P-9.6");
    }
    assertTransition("system", c.status, "paying");
    const attemptId = randomUUID();
    tx.update(pRef, {
      attemptId,
      status: "creating",
      outcome: "pending",
      error: FieldValue.delete(),
      updatedAt: now,
      events: FieldValue.arrayUnion({ type: "create.retry", source: "api", at: now }),
    });
    tx.update(cRef, { status: "paying" });
    auditInTx(tx, {
      actor,
      caseId,
      action: "payout.retry",
      policyClause: "P-9.7",
      before: { status: c.status, payoutStatus: p.status },
      after: { status: "paying", senderBatchId: p.senderBatchId, amountCents: p.amountCents },
      reason: "an operator sent the same payout request again; same sender_batch_id, so PayPal cannot pay it twice",
    });
    return { ...p, attemptId, status: "creating", outcome: "pending" } as ClaimedPayout;
  });

  const { payout, adopted } = await sendClaimedPayout(claimed, { note: payoutNote(fund.name, caseId), actor, policyClause: "P-9.7", adoptExistingBatch: true });
  if (!adopted) return payout;
  // The adopted batch may be old: apply whatever PayPal already decided for it.
  await refreshPayoutStatus(caseId).catch((err) => console.warn(`[payouts] could not refresh the adopted batch for ${caseId}:`, err instanceof Error ? err.message : err));
  return (await getPayout(caseId)) ?? payout;
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

  // In every branch below the money state is committed first and the payout's `outcome` marked after it.
  // `outcome` is what makes a redelivered event a no-op, so marking it first would turn one failed
  // transaction into a case that is never settled. settlePaid, reversePaid and releaseFunds are idempotent.
  if (info.outcome === "paid") {
    if (payout.outcome === "paid") return { caseId, outcome: "paid", changed: false };
    const { changed } = await settlePaid(caseId, payout.amountCents, {
      actor: "system",
      reason: `PayPal ${eventType}: item ${info.status}`,
      policyClause: "P-9",
      payoutBatchId: batchId,
    });
    await pRef.update({ outcome: "paid" });
    return { caseId, outcome: "paid", changed };
  }

  if (info.outcome === "failed") {
    if (payout.outcome === "failed" || payout.outcome === "reversed") return { caseId, outcome: "failed", changed: false };
    if (payout.outcome === "paid") {
      const { changed } = await reversePaid(caseId, payout.amountCents, {
        actor: "system",
        reason: `PayPal ${eventType}: ${info.status}${info.error ? ` (${info.error})` : ""} after SUCCESS; money returned to the fund`,
        policyClause: "P-9",
        payoutBatchId: batchId,
      });
      await pRef.update({ outcome: "reversed" });
      return { caseId, outcome: "failed", changed, note: "paid payout reversed" };
    }
    await releaseFunds(
      caseId,
      { actor: "system", reason: `PayPal ${eventType}: ${info.status}${info.error ? ` (${info.error})` : ""}`, policyClause: "P-9.6" },
      { afterFailedPayout: true },
    );
    // A case a volunteer already took back (rejected, or under review) stays where they put it.
    const current = await getCase(caseId);
    if (current && (current.status === "paying" || current.status === "approved")) {
      await setCaseStatus(caseId, "needs_review", {
        actor: "system",
        action: "payout.failed",
        reason: `payout ${info.status}${info.error ? `: ${info.error}` : ""}; a human must re-issue or contact the applicant`,
        policyClause: "P-9",
      });
    }
    await pRef.update({ outcome: "failed" });
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
