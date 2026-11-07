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

/** A case's audit trail, newest first. Filtered by case only (sorted in memory) so no composite index is needed. */
export async function listAuditForCase(caseId: string, limit = 40): Promise<AuditDoc[]> {
  const snap = await getDb().collection(col.auditLog).where("caseId", "==", caseId).get();
  return snap.docs
    .map((d) => d.data() as AuditDoc)
    .sort((a, b) => b.ts.toMillis() - a.ts.toMillis())
    .slice(0, limit);
}

/** Same, inside a transaction so the audit row commits with the change it describes. */
export function auditInTx(tx: Transaction, input: AuditInput): string {
  const ref = getDb().collection(col.auditLog).doc();
  tx.create(ref, { ...input, ts: Timestamp.now() } satisfies AuditDoc);
  return ref.id;
}
