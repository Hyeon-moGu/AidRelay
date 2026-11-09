"use client";

// Operator console: the queue (AG Grid), bulk actions, the case side panel and the live activity feed.
// Humans approve, reject and ask; the agent pays. Every action here lands in audit_log as human:ops.
import { LogOut, RefreshCw, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridApi } from "ag-grid-community";
import { Brand } from "@/components/site/brand";
import { STATUS_LABEL } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { money, num } from "@/lib/format";
import type { OpsFund, OpsRow, OpsRun } from "@/lib/ops/rows";
import { ActivityFeed } from "./activity-feed";
import { CasePanel, type CaseDetail } from "./case-panel";
import type { GridRow } from "./case-grid";

const CaseGrid = dynamic(() => import("./case-grid").then((m) => m.CaseGrid), {
  ssr: false,
  loading: () => <div aria-busy="true" className="h-[600px] animate-pulse rounded-xl border border-border bg-card" />,
});

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS_FILTERS = ["all", "needs_review", "needs_info", "parked", "approved", "paying", "paid", "rejected"] as const;

type Notice = { tone: "ok" | "error"; text: string } | null;

export function OpsConsole({ licenseKey }: { licenseKey: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<OpsRow[]>([]);
  const [fund, setFund] = useState<OpsFund | null>(null);
  const [runs, setRuns] = useState<OpsRun[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  /** The case being fetched for the side panel, so a click shows at once that it registered. */
  const [opening, setOpening] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const edits = useRef<Map<string, number | null>>(new Map());
  const api = useRef<GridApi<GridRow> | null>(null);

  const get = useCallback(
    async <T,>(url: string): Promise<T | null> => {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401) {
        router.replace("/ops/login");
        return null;
      }
      const json = (await res.json()) as ApiResult<T>;
      return json.ok ? json.data : null;
    },
    [router],
  );

  const refresh = useCallback(async () => {
    const data = await get<{ rows: OpsRow[]; fund: OpsFund }>("/api/ops/cases");
    if (data) {
      setRows(data.rows);
      setFund(data.fund);
    }
  }, [get]);

  const refreshRuns = useCallback(async () => {
    const data = await get<{ runs: OpsRun[] }>("/api/ops/runs?limit=15");
    if (data) setRuns(data.runs);
  }, [get]);

  useEffect(() => {
    void refresh();
    void refreshRuns();
    const a = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    const b = setInterval(() => {
      if (!document.hidden) void refreshRuns();
    }, 3000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh, refreshRuns]);

  const gridRows = useMemo<GridRow[]>(
    () =>
      rows
        .filter((r) => filter === "all" || r.status === filter)
        .map((r) => {
          const cents = edits.current.get(r.id) ?? r.amountCents;
          return { ...r, amountDollars: cents == null ? null : cents / 100 };
        }),
    [rows, filter],
  );

  const openCase = useCallback(
    async (id: string) => {
      setOpening(id);
      try {
        const data = await get<CaseDetail>(`/api/ops/cases/${id}`);
        if (data) setDetail(data);
      } finally {
        setOpening((current) => (current === id ? null : current));
      }
    },
    [get],
  );

  async function decide(action: "approve" | "reject" | "request_info" | "reopen") {
    if (selected.length === 0) {
      setNotice({ tone: "error", text: "Select one or more cases in the queue first." });
      return;
    }
    if (action === "reject" && !window.confirm(`Reject ${selected.length === 1 ? "this case" : `${selected.length} cases`}? Applicants will see “Not approved”.`)) return;
    setBusy(action);
    setNotice(null);
    try {
      const amounts: Record<string, number> = {};
      for (const id of selected) {
        const edited = edits.current.get(id);
        if (edited != null) amounts[id] = edited;
      }
      const body: Record<string, unknown> = { action, caseIds: selected };
      if (action === "approve") body.amounts = amounts;
      if (action === "reject" || action === "reopen") body.note = note || undefined;
      if (action === "request_info") body.questions = note ? [note] : [];
      const res = await fetch("/api/ops/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as ApiResult<{ results: Array<{ caseId: string; ok: boolean; error?: string }>; agentTriggered: boolean }>;
      if (!json.ok) throw new Error(json.error);
      const failed = json.data.results.filter((r) => !r.ok);
      const done = json.data.results.length - failed.length;
      const verb = { approve: "approved", reject: "rejected", request_info: "asked for info", reopen: "reopened" }[action];
      setNotice(
        failed.length
          ? { tone: "error", text: `${num(done)} ${verb}, ${num(failed.length)} refused: ${failed.map((f) => `${f.caseId} (${f.error})`).join("; ")}` }
          : { tone: "ok", text: `${done === 1 ? "1 case" : `${num(done)} cases`} ${verb}.${json.data.agentTriggered ? " The Case Officer is paying them now." : ""}` },
      );
      api.current?.deselectAll();
      setSelected([]);
      setNote("");
      await refresh();
      if (detail) await openCase(detail.case.id);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  /** Sends again a payout PayPal did not accept (same request, same batch id; see /api/ops/payout-retry). */
  async function retryPayout(caseId: string) {
    setBusy("retry");
    setNotice(null);
    try {
      const res = await fetch("/api/ops/payout-retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId }) });
      const json = (await res.json()) as ApiResult<{ status: string; payoutBatchId: string | null }>;
      if (!json.ok) throw new Error(json.error);
      setNotice({ tone: "ok", text: `${caseId}: PayPal accepted the payout${json.data.payoutBatchId ? ` (batch ${json.data.payoutBatchId})` : ""}.` });
    } catch (err) {
      setNotice({ tone: "error", text: `${caseId}: the payout was not sent. ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
      await refresh();
      await openCase(caseId);
    }
  }

  async function signOut() {
    await fetch("/api/ops/login", { method: "DELETE" });
    router.replace("/ops/login");
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
          <Brand href="/ops" suffix="Operator console" />
          <nav className="ml-auto flex items-center gap-1">
            <Link
              href="/ops/audit"
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/80"
            >
              <Sparkles aria-hidden="true" className="size-4" />
              Ask the ledger
            </Link>
            <Link href="/ledger" className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
              Public ledger
            </Link>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Case queue</h1>
            <p className="text-[13px] text-muted-foreground">Volunteers approve, reject and ask. The AI case officer pays, inside the guardrails.</p>
          </div>
          {fund && (
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {(
                [
                  ["Raised", fund.raisedCents],
                  ["Paid", fund.paidCents],
                  ["Reserved", fund.reservedCents],
                  ["Available", fund.balanceCents],
                ] as const
              ).map(([label, cents]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{money(cents)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((s) => {
            const active = filter === s;
            const n = s === "all" ? rows.length : (counts[s] ?? 0);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(s)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
                  active ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : STATUS_LABEL[s]}
                <span className={`tabular-nums ${active ? "" : "text-muted-foreground"}`}>{num(n)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
          <span className="px-1.5 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{num(selected.length)}</span> selected
          </span>
          <span aria-hidden="true" className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Button size="sm" disabled={!!busy} onClick={() => decide("approve")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => decide("request_info")}>
            Ask for info
          </Button>
          <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => decide("reject")}>
            Reject
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => decide("reopen")}>
            Reopen
          </Button>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note for a rejection, or the question to ask the applicant"
            placeholder="Note for a rejection, or the question to ask…"
            autoComplete="off"
            className={`${fieldClass} h-8 min-w-[240px] flex-1 text-sm`}
          />
          <Button size="icon-sm" variant="ghost" aria-label="Refresh the queue" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>

        <div aria-live="polite">
          {notice && (
            <p className={`animate-relay-in rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{notice.text}</p>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-label="Queue" className="min-w-0">
            <CaseGrid
              rows={gridRows}
              licenseKey={licenseKey}
              onReady={(a) => {
                api.current = a;
              }}
              onSelection={setSelected}
              onRowClick={openCase}
              onAmountEdit={(id, cents) => edits.current.set(id, cents)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Amounts in amber cells can be edited before approving. The agent pays approved cases in policy order (P-8) and still enforces every guardrail.
            </p>
          </section>
          <aside className="space-y-4">
            <section aria-labelledby="panel-title" className="rounded-xl border border-border bg-card p-4">
              <h2 id="panel-title" className="sr-only">
                Selected case
              </h2>
              {opening && opening !== detail?.case.id ? (
                <p role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-primary" />
                  Loading <span className="font-mono text-foreground">{opening}</span>…
                </p>
              ) : (
                <CasePanel detail={detail} onClose={() => setDetail(null)} onRetryPayout={(id) => void retryPayout(id)} retrying={busy === "retry"} />
              )}
            </section>
            <section aria-labelledby="feed-title" className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 id="feed-title" className="text-sm font-semibold">
                  AI case officer activity
                </h2>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  Live
                </span>
              </div>
              <div className="max-h-[720px] overflow-y-auto overscroll-contain p-3">
                <ActivityFeed runs={runs} />
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
