import { createHmac } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx } from "@/lib/db/repos/audit";
import { defaultFund, fundRef, withFundLock } from "@/lib/db/repos/fund";
import type { DonationDoc, DonationStatus, FundDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";

/** Stable, non-reversible donor reference for the ledger. Never store the email. */
export function donorRef(payerEmail: string | undefined): string | undefined {
  if (!payerEmail) return undefined;
  return createHmac("sha256", getEnv().AGENT_INTERNAL_SECRET)
    .update(payerEmail.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function createDonationRecord(input: {
  orderId: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  const doc: DonationDoc = {
    orderId: input.orderId,
    fundId: getEnv().FUND_ID,
    amountCents: input.amountCents,
    currency: input.currency,
    status: "created",
    createdAt: Timestamp.now(),
  };
  await getDb().collection(col.donations).doc(input.orderId).create(doc);
}

export async function getDonation(orderId: string): Promise<DonationDoc | undefined> {
  const snap = await getDb().collection(col.donations).doc(orderId).get();
  return snap.exists ? (snap.data() as DonationDoc) : undefined;
}

/** Captured donations, newest first. Only captured donations carry `capturedAt`, so ordering by it needs no composite index. */
export async function listRecentDonations(limit = 20): Promise<DonationDoc[]> {
  const snap = await getDb().collection(col.donations).orderBy("capturedAt", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data() as DonationDoc).filter((d) => d.status === "captured");
}

export interface RecordCaptureInput {
  orderId: string;
  captureId: string;
  captureStatus: string;
  amountCents: number;
  currency: string;
  payerEmail?: string;
  raw?: Record<string, unknown>;
  source: "api" | "webhook";
}

export interface RecordCaptureResult {
  /** true when this call is the one that added the amount to fund.raisedCents. */
  applied: boolean;
  raisedCents: number;
  donation: DonationDoc;
}

function statusFor(captureStatus: string): DonationStatus {
  if (captureStatus === "COMPLETED") return "captured";
  if (captureStatus === "DECLINED" || captureStatus === "FAILED") return "failed";
  return "pending";
}

/**
 * Records a capture exactly once. Both the capture API response and the
 * PAYMENT.CAPTURE.COMPLETED webhook call this; whichever arrives first adds the
 * amount to the fund, the other one is a no-op. Runs in a transaction.
 */
export async function recordDonationCapture(input: RecordCaptureInput): Promise<RecordCaptureResult> {
  const db = getDb();
  const fRef = fundRef();
  const dRef = db.collection(col.donations).doc(input.orderId);

  return withFundLock(() => db.runTransaction(async (tx) => {
    const [fSnap, dSnap] = await Promise.all([tx.get(fRef), tx.get(dRef)]);
    const fund: FundDoc = fSnap.exists ? (fSnap.data() as FundDoc) : defaultFund();
    const existing = dSnap.exists ? (dSnap.data() as DonationDoc) : undefined;
    const now = Timestamp.now();

    const completed = input.captureStatus === "COMPLETED";
    const alreadyApplied = existing?.status === "captured" && existing.captureId === input.captureId;

    const donation: DonationDoc = {
      orderId: input.orderId,
      fundId: fund.id,
      amountCents: input.amountCents,
      currency: input.currency,
      status: alreadyApplied ? "captured" : statusFor(input.captureStatus),
      captureId: input.captureId,
      captureStatus: input.captureStatus,
      donorRef: existing?.donorRef ?? donorRef(input.payerEmail),
      source: existing?.source ?? input.source,
      raw: input.raw ?? existing?.raw,
      createdAt: existing?.createdAt ?? now,
      capturedAt: existing?.capturedAt ?? (completed ? now : undefined),
    };
    tx.set(dRef, donation, { merge: true });

    if (alreadyApplied || !completed) {
      return { applied: false, raisedCents: fund.raisedCents, donation };
    }

    const raisedCents = fund.raisedCents + input.amountCents;
    if (fSnap.exists) {
      tx.update(fRef, { raisedCents, updatedAt: now });
    } else {
      tx.create(fRef, { ...fund, raisedCents, createdAt: now, updatedAt: now });
    }
    auditInTx(tx, {
      actor: "system",
      action: "donation.captured",
      before: { raisedCents: fund.raisedCents },
      after: { raisedCents },
      reason: `PayPal capture ${input.captureId} COMPLETED via ${input.source}`,
      refs: { orderId: input.orderId, captureId: input.captureId },
    });
    return { applied: true, raisedCents, donation };
  }));
}
