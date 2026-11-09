import { listRecentRuns } from "@/lib/db/repos/agentRuns";
import { fail, handleRouteError, ok } from "@/lib/http";
import { opsAccess } from "@/lib/ops/auth";
import { sharedForViewers, viewerRun } from "@/lib/ops/public-view";
import type { OpsRun } from "@/lib/ops/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadRuns(limit: number): Promise<OpsRun[]> {
  const runs = await listRecentRuns(limit);
  return runs.map((r) => ({
    id: r.id,
    trigger: r.trigger,
    caseId: r.caseId ?? null,
    status: r.status,
    summary: r.summary,
    cost: r.cost ?? null,
    ts: r.ts.toDate().toISOString(),
    finishedAt: r.finishedAt?.toDate().toISOString() ?? null,
    toolCalls: r.toolCalls.map((t) => ({ name: t.name, args: t.args, policyClause: t.policyClause ?? null, ms: t.ms, at: t.at.toDate().toISOString(), error: t.error ?? null, result: t.result ?? null })),
  }));
}

export async function GET(req: Request) {
  try {
    const access = await opsAccess();
    if (access === "none") return fail("sign in first", 401);
    const asked = Number(new URL(req.url).searchParams.get("limit") ?? 20);
    const limit = Math.min(50, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 20));
    if (access === "operator") return ok({ runs: await loadRuns(limit) });
    // Visitors of the open demo console see which tools ran, on which case and under which clause, not what they returned.
    const runs = await sharedForViewers(`runs:${limit}`, 2000, async () => (await loadRuns(limit)).map(viewerRun));
    return ok({ runs });
  } catch (err) {
    return handleRouteError(err, "ops/runs");
  }
}
