"use client";

// Live view of what the Case Officer is doing: every run, every tool call, the clause it cited.
import { HandCoins, Inbox, LoaderCircle, Send, Timer, UserCheck, type LucideIcon } from "lucide-react";
import { Chip } from "@/components/status-badge";
import { ago, num } from "@/lib/format";
import type { OpsRun } from "@/lib/ops/rows";

const TRIGGER: Record<string, { label: string; icon: LucideIcon }> = {
  "case.created": { label: "New application", icon: Inbox },
  "donation.captured": { label: "Donation captured", icon: HandCoins },
  "payout.webhook": { label: "Payout update", icon: Send },
  sweep: { label: "Scheduled sweep", icon: Timer },
  "operator.command": { label: "Volunteer action", icon: UserCheck },
};

function caseIdOf(args: unknown): string | null {
  return typeof args === "object" && args && "caseId" in args && typeof (args as { caseId: unknown }).caseId === "string" ? (args as { caseId: string }).caseId : null;
}

export function ActivityFeed({ runs }: { runs: OpsRun[] }) {
  if (runs.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">No agent activity yet. Submit an application or make a donation.</p>;
  }
  return (
    <ol className="space-y-2">
      {runs.map((r) => {
        const trig = TRIGGER[r.trigger] ?? { label: r.trigger, icon: Timer };
        return (
          <li key={r.id} className="animate-relay-in rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <trig.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {trig.label}
                {r.caseId && <span className="ml-1.5 font-mono text-[12px] font-normal text-muted-foreground">{r.caseId}</span>}
              </span>
              {r.status === "running" ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                  running
                </span>
              ) : r.status === "error" ? (
                <span className="text-xs font-medium text-danger">error</span>
              ) : (
                <span className="text-xs text-muted-foreground tabular-nums">{ago(r.finishedAt ?? r.ts)}</span>
              )}
            </div>
            {r.summary && <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-line">{r.summary}</p>}
            {r.toolCalls.length > 0 && (
              <ol className="mt-2.5 space-y-1 border-l border-border pl-3">
                {r.toolCalls.map((t, i) => {
                  const cid = caseIdOf(t.args);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                      <span className="font-mono font-medium">{t.name}</span>
                      {cid && <span className="font-mono text-muted-foreground">{cid}</span>}
                      {t.policyClause && (
                        <Chip tone="accent" mono>
                          {t.policyClause}
                        </Chip>
                      )}
                      <span className="ml-auto text-muted-foreground tabular-nums">{num(t.ms)} ms</span>
                      {t.error && <span className="w-full text-danger">{t.error}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
            {r.cost && (
              <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {r.cost.modelCalls} model call{r.cost.modelCalls === 1 ? "" : "s"} · {num(r.cost.inputTokens)} in / {num(r.cost.outputTokens)} out
                {r.cost.cachedInputTokens ? ` · ${num(r.cost.cachedInputTokens)} cached` : ""}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
