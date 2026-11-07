"use client";

// The queue: AG Grid Enterprise, grouped by tier, multi-row selection, inline amount edit.
import {
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type RowClickedEvent,
  type RowSelectionOptions,
  type SelectionChangedEvent,
} from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo } from "react";
import type { OpsRow } from "@/lib/ops/rows";

ModuleRegistry.registerModules([AllEnterpriseModule]);

export interface GridRow extends OpsRow {
  /** Editable: the amount the operator will approve, in dollars. */
  amountDollars: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  new: "bg-zinc-100 text-zinc-800",
  evaluating: "bg-sky-100 text-sky-900",
  needs_info: "bg-amber-100 text-amber-900",
  needs_review: "bg-orange-100 text-orange-900",
  approved: "bg-emerald-100 text-emerald-900",
  parked: "bg-violet-100 text-violet-900",
  paying: "bg-emerald-200 text-emerald-900",
  paid: "bg-emerald-600 text-white",
  rejected: "bg-red-100 text-red-900",
};

function StatusCell(p: ICellRendererParams<GridRow, string>) {
  if (!p.value) return null;
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.value] ?? ""}`}>{p.value.replace("_", " ")}</span>;
}

function FlagsCell(p: ICellRendererParams<GridRow, string[]>) {
  if (!p.value?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {p.value.map((f) => (
        <span key={f} className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-900">
          {f.replace(/_/g, " ")}
        </span>
      ))}
    </span>
  );
}

const EDITABLE = new Set(["needs_review", "needs_info", "parked", "approved"]);
const money = (v: number | null | undefined) => (v == null ? "" : `$${(v / 100).toFixed(2)}`);

export function CaseGrid({
  rows,
  licenseKey,
  onReady,
  onSelection,
  onRowClick,
  onAmountEdit,
}: {
  rows: GridRow[];
  licenseKey: string;
  onReady: (api: GridApi<GridRow>) => void;
  onSelection: (ids: string[]) => void;
  onRowClick: (id: string) => void;
  onAmountEdit: (id: string, cents: number | null) => void;
}) {
  if (licenseKey) LicenseManager.setLicenseKey(licenseKey);

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "tier", rowGroup: true, hide: true, valueFormatter: (p) => (p.value == null ? "not yet tiered" : `Tier ${p.value}`) },
      { field: "id", headerName: "Case", width: 110, pinned: "left" },
      { field: "status", width: 150, cellRenderer: StatusCell, filter: "agSetColumnFilter" },
      {
        field: "amountDollars",
        headerName: "Amount",
        width: 120,
        editable: (p) => !!p.data && EDITABLE.has(p.data.status),
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, max: 1300, precision: 2 },
        valueFormatter: (p) => (p.value == null ? "" : `$${Number(p.value).toFixed(2)}`),
        cellClass: (p) => (p.data && EDITABLE.has(p.data.status) ? "bg-amber-50" : ""),
        aggFunc: "sum",
      },
      { field: "requestedAmountCents", headerName: "Requested", width: 110, valueFormatter: (p) => money(p.value) },
      { field: "zip", width: 90 },
      { field: "householdSize", headerName: "HH", width: 70 },
      { field: "lang", width: 70 },
      { field: "confidence", width: 100, valueFormatter: (p) => (p.value == null ? "" : `${Math.round(p.value * 100)}%`) },
      { field: "redFlags", headerName: "Flags", width: 220, cellRenderer: FlagsCell, autoHeight: true },
      { field: "secondEvaluationAgrees", headerName: "2nd eval", width: 90, valueFormatter: (p) => (p.value == null ? "" : p.value ? "agrees" : "differs") },
      { field: "ledgerSummary", headerName: "AI summary", flex: 1, minWidth: 220 },
      { field: "minutesToCash", headerName: "Min to cash", width: 110 },
      { field: "payoutBatchId", headerName: "PayPal batch", width: 150 },
      { field: "createdAt", headerName: "Received", width: 170, valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : ""), sort: "desc" },
    ],
    [],
  );

  const rowSelection = useMemo<RowSelectionOptions<GridRow>>(
    () => ({ mode: "multiRow", checkboxes: true, headerCheckbox: true, groupSelects: "descendants", enableClickSelection: false }),
    [],
  );

  const onGridReady = useCallback((e: GridReadyEvent<GridRow>) => onReady(e.api), [onReady]);
  const onSelectionChanged = useCallback((e: SelectionChangedEvent<GridRow>) => onSelection(e.api.getSelectedRows().map((r) => r.id)), [onSelection]);
  const onRowClicked = useCallback(
    (e: RowClickedEvent<GridRow>) => {
      if (e.data) onRowClick(e.data.id);
    },
    [onRowClick],
  );
  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<GridRow>) => {
      if (e.colDef.field === "amountDollars") onAmountEdit(e.data.id, e.newValue == null || e.newValue === "" ? null : Math.round(Number(e.newValue) * 100));
    },
    [onAmountEdit],
  );

  return (
    <div className="h-[600px] w-full">
      <AgGridReact<GridRow>
        theme={themeQuartz}
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        rowSelection={rowSelection}
        groupDefaultExpanded={1}
        autoGroupColumnDef={{ headerName: "Tier", minWidth: 180, pinned: "left" }}
        animateRows
        onGridReady={onGridReady}
        onSelectionChanged={onSelectionChanged}
        onRowClicked={onRowClicked}
        onCellValueChanged={onCellValueChanged}
      />
    </div>
  );
}
