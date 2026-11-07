import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { GuardrailError } from "@/lib/agent/guardrails";
import { assertTransition } from "@/lib/agent/transitions";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx } from "@/lib/db/repos/audit";
import { fundBalanceCents, type AuditActor, type CaseDoc, type FundDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";

export function fundRef(): DocumentReference {
  return getDb().collection(col.fund).doc(getEnv().FUND_ID);
}

/** Zero-balance fund used until `pnpm seed` writes the real name/policy version. */
export function defaultFund(): FundDoc {
  const now = Timestamp.now();
  return {
    id: getEnv().FUND_ID,
    name: "Relief Fund",
    currency: "USD",
    raisedCents: 0,
    paidCents: 0,
    reservedCents: 0,
    policyVersion: "v1",
    createdAt: now,
    updatedAt: now,
  };
}

/** Reads the fund, creating the default document on first use. */
export async function getFund(): Promise<FundDoc> {
  const ref = fundRef();
  const snap = await ref.get();
  if (snap.exists) return snap.data() as FundDoc;
  try {
    await ref.create(defaultFund());
  } catch {
    // created concurrently by another request
  }
  return (await ref.get()).data() as FundDoc;
}

export class InsufficientFundsError extends Error {
  constructor(
    public readonly neededCents: number,
    public readonly availableCents: number,
  ) {
    super(`insufficient funds: need ${neededCents}, available ${availableCents}`);
    this.name = "InsufficientFundsError";
  }
}

export interface FundChangeMeta {
  actor: AuditActor;
  reason: string;
  policyClause: string;
}

/**
 * Reserves `amountCents` for a case before any payout. Idempotent: reserving the
 * same amount twice is a no-op; a different amount replaces the earlier reservation.
 * Throws InsufficientFundsError instead of ever overdrawing.
 */
export async function reserveFunds(caseId: string, amountCents: number, meta: FundChangeMeta): Promise<{ balanceAfterCents: number }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`bad reservation amount ${amountCents}`);
  const db = getDb();
  const fRef = fundRef();
  const cRef = db.collection(col.cases).doc(caseId);
  return db.runTransaction(async (tx) => {
    const [fSnap, cSnap] = await Promise.all([tx.get(fRef), tx.get(cRef)]);
    if (!cSnap.exists) throw new Error(`case ${caseId} not found`);
    const fund = fSnap.exists ? (fSnap.data() as FundDoc) : defaultFund();
    const c = cSnap.data() as CaseDoc;
    if (c.status !== "approved" && c.status !== "parked") {
      throw new GuardrailError("status_not_payable", `cannot reserve funds for a ${c.status} case`, "P-9.6");
    }
    const already = c.reservedCents ?? 0;
    const available = fundBalanceCents(fund) + already;
    if (available < amountCents) throw new InsufficientFundsError(amountCents, available);
    const reservedCents = fund.reservedCents - already + amountCents;
    const now = Timestamp.now();
    if (fSnap.exists) tx.update(fRef, { reservedCents, updatedAt: now });
    else tx.create(fRef, { ...fund, reservedCents, createdAt: now, updatedAt: now });
    tx.update(cRef, { reservedCents: amountCents });
    auditInTx(tx, {
      actor: meta.actor,
      caseId,
      action: "fund.reserve",
      policyClause: meta.policyClause,
      before: { reservedCents: fund.reservedCents, caseReservedCents: already },
      after: { reservedCents, caseReservedCents: amountCents },
      reason: meta.reason,
    });
    return { balanceAfterCents: fundBalanceCents({ ...fund, reservedCents }) };
  });
}

/**
 * Releases a case's reservation. Refused while a payout is in flight or settled (the money is
 * committed), except from the payout-failure path, which passes `afterFailedPayout`.
 */
export async function releaseFunds(
  caseId: string,
  meta: FundChangeMeta,
  opts: { afterFailedPayout?: boolean } = {},
): Promise<{ releasedCents: number }> {
  const db = getDb();
  const fRef = fundRef();
  const cRef = db.collection(col.cases).doc(caseId);
  return db.runTransaction(async (tx) => {
    const [fSnap, cSnap] = await Promise.all([tx.get(fRef), tx.get(cRef)]);
    if (!cSnap.exists || !fSnap.exists) return { releasedCents: 0 };
    const fund = fSnap.data() as FundDoc;
    const c = cSnap.data() as CaseDoc;
    if ((c.status === "paying" || c.status === "paid") && !opts.afterFailedPayout) {
      throw new GuardrailError("illegal_transition", `cannot release the reservation of a ${c.status} case`, "P-9.6");
    }
    const releasedCents = c.reservedCents ?? 0;
    if (releasedCents === 0) return { releasedCents: 0 };
    const reservedCents = Math.max(0, fund.reservedCents - releasedCents);
    tx.update(fRef, { reservedCents, updatedAt: Timestamp.now() });
    tx.update(cRef, { reservedCents: 0 });
    auditInTx(tx, {
      actor: meta.actor,
      caseId,
      action: "fund.release",
      policyClause: meta.policyClause,
      before: { reservedCents: fund.reservedCents },
      after: { reservedCents },
      reason: meta.reason,
    });
    return { releasedCents };
  });
}

/**
 * Money came back after a SUCCESS (REFUNDED / REVERSED / RETURNED): takes the amount out of paidCents
 * and hands the case to a human. Idempotent: a case that is no longer `paid` is left alone.
 */
export async function reversePaid(caseId: string, amountCents: number, meta: FundChangeMeta & { payoutBatchId?: string }): Promise<{ changed: boolean }> {
  const db = getDb();
  const fRef = fundRef();
  const cRef = db.collection(col.cases).doc(caseId);
  return db.runTransaction(async (tx) => {
    const [fSnap, cSnap] = await Promise.all([tx.get(fRef), tx.get(cRef)]);
    if (!cSnap.exists || !fSnap.exists) throw new Error(`fund or case ${caseId} missing`);
    const fund = fSnap.data() as FundDoc;
    const c = cSnap.data() as CaseDoc;
    if (c.status !== "paid") return { changed: false };
    assertTransition("system", c.status, "needs_review");
    const paidCents = Math.max(0, fund.paidCents - amountCents);
    const now = Timestamp.now();
    tx.update(fRef, { paidCents, updatedAt: now });
    tx.update(cRef, { status: "needs_review" });
    auditInTx(tx, {
      actor: meta.actor,
      caseId,
      action: "payout.reversed",
      policyClause: meta.policyClause,
      before: { status: "paid", paidCents: fund.paidCents },
      after: { status: "needs_review", paidCents },
      reason: meta.reason,
      refs: meta.payoutBatchId ? { payoutBatchId: meta.payoutBatchId } : undefined,
    });
    return { changed: true };
  });
}

/** Moves a case's reservation into paid and marks the case paid. Idempotent once the case is paid. */
export async function settlePaid(caseId: string, amountCents: number, meta: FundChangeMeta & { payoutBatchId?: string }): Promise<{ changed: boolean }> {
  const db = getDb();
  const fRef = fundRef();
  const cRef = db.collection(col.cases).doc(caseId);
  return db.runTransaction(async (tx) => {
    const [fSnap, cSnap] = await Promise.all([tx.get(fRef), tx.get(cRef)]);
    if (!cSnap.exists || !fSnap.exists) throw new Error(`fund or case ${caseId} missing`);
    const fund = fSnap.data() as FundDoc;
    const c = cSnap.data() as CaseDoc;
    if (c.status === "paid") return { changed: false };
    assertTransition("system", c.status, "paid");
    const reservedForCase = c.reservedCents ?? 0;
    const now = Timestamp.now();
    tx.update(fRef, {
      reservedCents: Math.max(0, fund.reservedCents - reservedForCase),
      paidCents: fund.paidCents + amountCents,
      updatedAt: now,
    });
    tx.update(cRef, {
      reservedCents: 0,
      status: "paid",
      "timestamps.paid": now,
      ...(meta.payoutBatchId ? { payoutBatchId: meta.payoutBatchId } : {}),
    });
    auditInTx(tx, {
      actor: meta.actor,
      caseId,
      action: "case.paid",
      policyClause: meta.policyClause,
      before: { status: c.status, paidCents: fund.paidCents, reservedCents: fund.reservedCents },
      after: { status: "paid", paidCents: fund.paidCents + amountCents, reservedCents: fund.reservedCents - reservedForCase },
      reason: meta.reason,
      refs: meta.payoutBatchId ? { payoutBatchId: meta.payoutBatchId } : undefined,
    });
    return { changed: true };
  });
}
