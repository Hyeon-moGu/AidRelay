// P-10 bookkeeping: every payout the agent made without a human, for the rolling-window limits.
import { Timestamp } from "firebase-admin/firestore";
import type { RecentAutoPayout } from "@/lib/agent/guardrails";
import { col, getDb } from "@/lib/db/firestore";

interface AutoApprovalDoc {
  caseId: string;
  amountCents: number;
  at: Timestamp;
}

export async function recordAutoPayout(caseId: string, amountCents: number): Promise<void> {
  const doc: AutoApprovalDoc = { caseId, amountCents, at: Timestamp.now() };
  await getDb().collection(col.autoApprovals).doc(caseId).set(doc);
}

/** Auto payouts in the last `hours` (default 24). Single-field range query: no composite index needed. */
export async function recentAutoPayouts(hours = 24): Promise<RecentAutoPayout[]> {
  const since = Timestamp.fromMillis(Date.now() - hours * 3_600_000);
  const snap = await getDb().collection(col.autoApprovals).where("at", ">=", since).get();
  return snap.docs.map((d) => {
    const data = d.data() as AutoApprovalDoc;
    return { amountCents: data.amountCents, atMs: data.at.toMillis() };
  });
}
