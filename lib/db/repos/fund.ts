import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/db/firestore";
import { getEnv } from "@/lib/env";
import type { FundDoc } from "@/lib/db/types";

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
