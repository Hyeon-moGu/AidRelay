"use client";

// Public per-case table: AG Grid Community (no licence needed, no watermark), themed with the app tokens.
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";
import { StatusBadge } from "@/components/status-badge";
import { duration, local, money } from "@/lib/format";
import { NEED_LABEL } from "@/lib/ledger/labels";
import type { LedgerRow } from "@/lib/ledger/public";
import { ledgerGridTheme } from "@/lib/ui/grid-theme";

ModuleRegistry.registerModules([AllCommunityModule]);

function StatusCell(p: ICellRendererParams<LedgerRow, string>) {
  return p.value ? <StatusBadge status={p.value} /> : null;
}

function BatchCell(p: ICellRendererParams<LedgerRow, string | null>) {
  return p.value ? (
    <span className="font-mono text-[12.5px]" translate="no">
      {p.value}
    </span>
  ) : (
    <span className="text-muted-foreground">pending</span>
  );
}

const AUTO_HEIGHT_MAX_ROWS = 12;

export function LedgerGrid({ rows }: { rows: LedgerRow[] }) {
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "caseId", headerName: "Case", width: 110, cellClass: "font-mono text-[12.5px]" },
      { field: "status", width: 170, cellRenderer: StatusCell },
      { field: "amountCents", headerName: "Amount", width: 115, type: "rightAligned", valueFormatter: (p) => money(p.value), cellClass: "tabular-nums font-medium" },
      { field: "summary", headerName: "What happened", flex: 1, minWidth: 280, tooltipField: "summary" },
      { field: "zipPrefix", headerName: "Zip", width: 80, cellClass: "tabular-nums" },
      { field: "tier", headerName: "Need", width: 170, valueFormatter: (p) => (p.value == null ? "" : `${p.value} · ${NEED_LABEL[p.value] ?? ""}`) },
      { field: "humanReviewed", headerName: "Approved by", width: 150, valueFormatter: (p) => (p.value ? "A volunteer" : "The AI on its own") },
      { field: "payoutBatchId", headerName: "PayPal payout id", width: 190, cellRenderer: BatchCell },
      { field: "minutesToCash", headerName: "Time to cash", width: 120, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : duration(p.value)), cellClass: "tabular-nums" },
      { field: "receivedAt", headerName: "Applied", width: 140, valueFormatter: (p) => local(p.value), sort: "desc", cellClass: "tabular-nums" },
    ],
    [],
  );
  const autoHeight = rows.length <= AUTO_HEIGHT_MAX_ROWS;
  return (
    <div className={autoHeight ? "w-full" : "h-[560px] w-full"}>
      <AgGridReact<LedgerRow>
        theme={ledgerGridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        getRowId={(p) => p.data.caseId}
        domLayout={autoHeight ? "autoHeight" : "normal"}
        suppressCellFocus
        enableCellTextSelection
      />
    </div>
  );
}
