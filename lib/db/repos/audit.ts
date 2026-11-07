import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/db/firestore";
import type { AuditDoc } from "@/lib/db/types";

export type AuditInput = Omit<AuditDoc, "ts">;

/** Every state change is written to audit_log with the policy clause it relied on. */
export async function writeAudit(input: AuditInput): Promise<string> {
  const ref = getDb().collection(col.auditLog).doc();
  await ref.create({ ...input, ts: Timestamp.now() } satisfies AuditDoc);
  return ref.id;
}

/** Same, inside a transaction so the audit row commits with the change it describes. */
export function auditInTx(tx: Transaction, input: AuditInput): string {
  const ref = getDb().collection(col.auditLog).doc();
  tx.create(ref, { ...input, ts: Timestamp.now() } satisfies AuditDoc);
  return ref.id;
}
