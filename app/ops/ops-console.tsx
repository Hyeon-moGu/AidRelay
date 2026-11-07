"use client";

// Operator console: the queue (AG Grid), bulk actions, the case side panel and the live activity feed.
// Humans approve, reject and ask; the agent pays. Every action here lands in audit_log as human:ops.
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GridApi } from "ag-grid-community";
import { Button } from "@/components/ui/button";
import type { OpsFund, OpsRow, OpsRun } from "@/lib/ops/rows";
import { ActivityFeed } from "./activity-feed";
import { CasePanel, type CaseDetail } from "./case-panel";
import type { GridRow } from "./case-grid";

const CaseGrid = dynamic(() => import("./case-grid").then((m) => m.CaseGrid), { ssr: false, loading: () => <p className="text-sm text-zinc-500">Loading queue…</p> });

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const STATUS_FILTERS = ["all", "needs_review", "needs_info", "parked", "approved", "paying", "paid", "rejected"] as const;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function OpsConsole({ licenseKey }: { licenseKey: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<OpsRow[]>([]);
  const [fund, setFund] = useState<OpsFund | null>(null);
  const [runs, setRuns] = useState<OpsRun[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
    const a = setInterval(() => void refresh(), 5000);
    const b = setInterval(() => void refreshRuns(), 3000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [refresh, refreshRuns]);

  const gridRows = useMemo<GridRow[]>(
    () =>
      rows
        .filter((r) => filter === "all" || r.status === filter)
        .map((r) => ({ ...r, amountDollars: (edits.current.get(r.id) ?? r.amountCents) == null ? null : (edits.current.get(r.id) ?? r.amountCents)! / 100 })),
    [rows, filter],
  );

  const openCase = useCallback(
    async (id: string) => {
      const data = await get<CaseDetail>(`/api/ops/cases/${id}`);
      if (data) setDetail(data);
    },
    [get],
  );

  async function decide(action: "approve" | "reject" | "request_info" | "reopen") {
    if (selected.length === 0) return;
    setBusy(action);
    setToast(null);
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
      setToast(
        failed.length
          ? `${json.data.results.length - failed.length} done, ${failed.length} refused: ${failed.map((f) => `${f.caseId} (${f.error})`).join("; ")}`
          : `${json.data.results.length} case(s) ${action.replace("_", " ")}d${json.data.agentTriggered ? "; the Case Officer is paying them now" : ""}`,
      );
      api.current?.deselectAll();
      setSelected([]);
      setNote("");
      await refresh();
      if (detail) await openCase(detail.case.id);
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
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
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay · operator console</p>
          <h1 className="text-xl font-semibold">Case queue</h1>
        </div>
        {fund && (
          <dl className="flex gap-4 text-sm">
            {[
              ["Raised", fund.raisedCents],
              ["Paid", fund.paidCents],
              ["Reserved", fund.reservedCents],
              ["Available", fund.balanceCents],
            ].map(([label, cents]) => (
              <div key={label as string} className="rounded-md border border-zinc-200 px-3 py-1 dark:border-zinc-800">
                <dt className="text-[11px] uppercase text-zinc-500">{label}</dt>
                <dd className="font-semibold">{money(cents as number)}</dd>
              </div>
            ))}
          </dl>
        )}
        <button type="button" onClick={signOut} className="text-xs text-zinc-500 underline">
          sign out
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === s ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 dark:border-zinc-700"}`}
          >
            {s === "all" ? `all ${rows.length}` : `${s.replace("_", " ")} ${counts[s] ?? 0}`}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
        <span className="text-sm text-zinc-500">{selected.length} selected</span>
        <Button size="sm" disabled={!selected.length || !!busy} onClick={() => decide("approve")}>
          Approve selected
        </Button>
        <Button size="sm" variant="outline" disabled={!selected.length || !!busy} onClick={() => decide("request_info")}>
          Ask for info
        </Button>
        <Button size="sm" variant="outline" disabled={!selected.length || !!busy} onClick={() => decide("reject")}>
          Reject
        </Button>
        <Button size="sm" variant="ghost" disabled={!selected.length || !!busy} onClick={() => decide("reopen")}>
          Reopen
        </Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (reject) or question (ask for info)"
          className="min-w-[280px] flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
        />
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>
          Refresh
        </Button>
        {toast && <span className="text-xs text-zinc-600 dark:text-zinc-400">{toast}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="min-w-0">
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
          <p className="mt-1 text-[11px] text-zinc-500">Amounts in amber cells can be edited before approving. The agent pays approved cases in policy order (P-8) and still enforces every guardrail.</p>
        </section>
        <aside className="space-y-6">
          <section className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <h2 className="mb-2 text-sm font-medium text-zinc-500">Selected case</h2>
            <CasePanel detail={detail} onClose={() => setDetail(null)} />
          </section>
          <section>
            <h2 className="mb-2 text-sm font-medium text-zinc-500">Case Officer activity</h2>
            <ActivityFeed runs={runs} />
          </section>
        </aside>
      </div>
    </main>
  );
}
