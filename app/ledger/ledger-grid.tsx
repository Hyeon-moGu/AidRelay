"use client";

// Public per-case table: AG Grid Community (no licence needed, no watermark).
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import type { LedgerRow } from "@/lib/ledger/public";

ModuleRegistry.registerModules([AllCommunityModule]);

const money = (c: number | null | undefined) => (c == null ? "" : `$${(c / 100).toFixed(2)}`);

function StatusCell(p: ICellRendererParams<LedgerRow, string>) {
  const v = p.value ?? "";
  const cls = v === "paid" ? "bg-emerald-600 text-white" : v === "paying" ? "bg-emerald-200 text-emerald-900" : v === "parked" ? "bg-violet-100 text-violet-900" : "bg-zinc-100 text-zinc-800";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{v === "parked" ? "waiting for funds" : v}</span>;
}

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "caseId", headerName: "Case", width: 110 },
      { field: "status", width: 150, cellRenderer: StatusCell },
      { field: "zipPrefix", headerName: "Zip", width: 80 },
      { field: "tier", width: 80 },
      { field: "amountCents", headerName: "Amount", width: 110, valueFormatter: (p) => money(p.value) },
      { field: "summary", headerName: "What happened (AI summary)", flex: 1, minWidth: 260 },
      { field: "humanReviewed", headerName: "Human reviewed", width: 130, valueFormatter: (p) => (p.value ? "yes" : "no") },
      { field: "payoutBatchId", headerName: "PayPal payout batch", width: 180 },
      { field: "minutesToCash", headerName: "Minutes to cash", width: 130 },
      { field: "receivedAt", headerName: "Received", width: 170, valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : ""), sort: "desc" },
    ],
    [],
  );
  return (
    <div className="h-[420px] w-full">
      <AgGridReact<LedgerRow> theme={themeQuartz} rowData={rows} columnDefs={columnDefs} getRowId={(p) => p.data.caseId} domLayout="normal" />
    </div>
  );
}
