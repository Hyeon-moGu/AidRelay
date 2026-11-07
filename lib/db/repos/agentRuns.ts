import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { col, getDb } from "@/lib/db/firestore";
import type { AgentRunDoc, ToolCallRecord } from "@/lib/db/types";

export async function startRun(trigger: string, meta: { caseId?: string; orderId?: string; eventId?: string }): Promise<string> {
  const ref = getDb().collection(col.agentRuns).doc();
  const doc: AgentRunDoc = {
    id: ref.id,
    trigger,
    caseId: meta.caseId,
    orderId: meta.orderId,
    eventId: meta.eventId,
    status: "running",
    toolCalls: [],
    summary: "",
    ts: Timestamp.now(),
  };
  await ref.create(doc);
  return ref.id;
}

/** Written as each tool returns so the /ops activity feed is live. */
export async function appendToolCall(runId: string, call: ToolCallRecord): Promise<void> {
  await getDb()
    .collection(col.agentRuns)
    .doc(runId)
    .update({ toolCalls: FieldValue.arrayUnion(call) });
}

export async function finishRun(
  runId: string,
  result: { summary: string; status: "done" | "error"; cost?: AgentRunDoc["cost"]; error?: string; caseId?: string },
): Promise<void> {
  await getDb()
    .collection(col.agentRuns)
    .doc(runId)
    .update({
      summary: result.summary.slice(0, 4000),
      status: result.status,
      ...(result.cost ? { cost: result.cost } : {}),
      ...(result.error ? { error: result.error.slice(0, 1000) } : {}),
      ...(result.caseId ? { caseId: result.caseId } : {}),
      finishedAt: Timestamp.now(),
    });
}

export async function listRecentRuns(limit = 30): Promise<AgentRunDoc[]> {
  const snap = await getDb().collection(col.agentRuns).orderBy("ts", "desc").limit(limit).get();
  return snap.docs.map((d) => d.data() as AgentRunDoc);
}
