import { listRecentRuns } from "@/lib/db/repos/agentRuns";
import { fail, handleRouteError, ok } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20)));
    const runs = await listRecentRuns(limit);
    return ok({
      runs: runs.map((r) => ({
        id: r.id,
        trigger: r.trigger,
        caseId: r.caseId ?? null,
        status: r.status,
        summary: r.summary,
        cost: r.cost ?? null,
        ts: r.ts.toDate().toISOString(),
        finishedAt: r.finishedAt?.toDate().toISOString() ?? null,
        toolCalls: r.toolCalls.map((t) => ({ name: t.name, args: t.args, policyClause: t.policyClause ?? null, ms: t.ms, at: t.at.toDate().toISOString(), error: t.error ?? null, result: t.result ?? null })),
      })),
    });
  } catch (err) {
    return handleRouteError(err, "ops/runs");
  }
}
