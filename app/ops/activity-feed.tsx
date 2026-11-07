"use client";

// Live view of what the Case Officer is doing: every run, every tool call, the clause it cited.
import type { OpsRun } from "@/lib/ops/rows";

const TRIGGER_LABEL: Record<string, string> = {
  "case.created": "new application",
  "donation.captured": "donation captured",
  "payout.webhook": "payout update",
  sweep: "scheduled sweep",
  "operator.command": "operator action",
};

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function ActivityFeed({ runs }: { runs: OpsRun[] }) {
  if (runs.length === 0) return <p className="text-sm text-zinc-500">No agent activity yet. Submit an application or make a donation.</p>;
  return (
    <ol className="space-y-3">
      {runs.map((r) => (
        <li key={r.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {TRIGGER_LABEL[r.trigger] ?? r.trigger}
              {r.caseId ? ` · ${r.caseId}` : ""}
            </span>
            <span className={`text-xs ${r.status === "error" ? "text-red-600" : r.status === "running" ? "text-sky-600" : "text-zinc-500"}`}>
              {r.status === "running" ? "running" : ago(r.finishedAt ?? r.ts)}
            </span>
          </div>
          {r.summary && <p className="mt-1 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{r.summary}</p>}
          {r.toolCalls.length > 0 && (
            <ol className="mt-2 space-y-1 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
              {r.toolCalls.map((t, i) => (
                <li key={i} className="text-xs">
                  <span className="font-mono">{t.name}</span>
                  {typeof t.args === "object" && t.args && "caseId" in (t.args as Record<string, unknown>) ? <span className="text-zinc-500"> {(t.args as { caseId: string }).caseId}</span> : null}
                  {t.policyClause && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">{t.policyClause}</span>}
                  <span className="ml-1 text-zinc-400">{t.ms} ms</span>
                  {t.error && <span className="ml-1 text-red-600">{t.error}</span>}
                </li>
              ))}
            </ol>
          )}
          {r.cost && (
            <p className="mt-1 text-[11px] text-zinc-400">
              {r.cost.modelCalls} model call(s) · {r.cost.inputTokens} in / {r.cost.outputTokens} out tokens{r.cost.cachedInputTokens ? ` · ${r.cost.cachedInputTokens} cached` : ""}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
