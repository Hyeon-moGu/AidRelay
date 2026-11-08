"use client";

// The queue: AG Grid Enterprise, grouped by tier, multi-row selection, inline amount edit.
import {
  ModuleRegistry,
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
import { Chip, StatusBadge } from "@/components/status-badge";
import { dollars, duration, local, money } from "@/lib/format";
import type { OpsRow } from "@/lib/ops/rows";
import { opsGridTheme } from "@/lib/ui/grid-theme";

ModuleRegistry.registerModules([AllEnterpriseModule]);

export interface GridRow extends OpsRow {
  /** Editable: the amount the operator will approve, in dollars. */
  amountDollars: number | null;
}

function StatusCell(p: ICellRendererParams<GridRow, string>) {
  return p.value ? <StatusBadge status={p.value} /> : null;
}

function FlagsCell(p: ICellRendererParams<GridRow, string[]>) {
  if (!p.data) return null;
  if (!p.value?.length) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="flex flex-wrap gap-1 py-1.5">
      {p.value.map((f) => (
        <Chip key={f} tone="danger">
          {f.replace(/_/g, " ")}
        </Chip>
      ))}
    </span>
  );
}

function SecondEvalCell(p: ICellRendererParams<GridRow, boolean | null>) {
  if (p.value == null) return null;
  return p.value ? <Chip tone="success">agrees</Chip> : <Chip tone="warning">differs</Chip>;
}

function MonoCell(p: ICellRendererParams<GridRow, string | null>) {
  return p.value ? (
    <span className="font-mono text-[12px]" translate="no">
      {p.value}
    </span>
  ) : null;
}

const EDITABLE = new Set(["needs_review", "needs_info", "parked", "approved"]);

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
      { field: "tier", rowGroup: true, hide: true, valueFormatter: (p) => (p.value == null ? "Not yet tiered" : `Tier ${p.value}`) },
      { field: "id", headerName: "Case", width: 115, pinned: "left", cellRenderer: MonoCell },
      { field: "status", width: 150, cellRenderer: StatusCell, filter: "agSetColumnFilter" },
      {
        field: "amountDollars",
        headerName: "Amount",
        width: 115,
        type: "rightAligned",
        editable: (p) => !!p.data && EDITABLE.has(p.data.status),
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, max: 1300, precision: 2 },
        // A case the agent could not price (needs info, or flagged) shows a prompt instead of an empty amber cell.
        valueFormatter: (p) => (p.value == null && p.data && EDITABLE.has(p.data.status) ? "Set amount" : dollars(p.value)),
        cellClass: (p) => {
          if (!p.data || !EDITABLE.has(p.data.status)) return "tabular-nums font-medium";
          return p.value == null ? "cell-editable text-muted-foreground" : "cell-editable tabular-nums font-medium";
        },
        aggFunc: "sum",
      },
      { field: "requestedAmountCents", headerName: "Requested", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value), cellClass: "tabular-nums" },
      { field: "confidence", width: 105, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : `${Math.round(p.value * 100)}%`), cellClass: "tabular-nums" },
      {
        field: "redFlags",
        headerName: "Flags",
        width: 220,
        cellRenderer: FlagsCell,
        autoHeight: true,
        // Text form for filtering, copy and export; AG Grid 36 also warns (#48) when an array column has none.
        valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(", ") : ""),
      },
      { field: "secondEvaluationAgrees", headerName: "2nd eval", width: 95, cellRenderer: SecondEvalCell },
      { field: "ledgerSummary", headerName: "AI summary", flex: 1, minWidth: 240, tooltipField: "ledgerSummary" },
      { field: "zip", width: 85, cellClass: "tabular-nums" },
      { field: "householdSize", headerName: "HH", width: 68, type: "rightAligned", cellClass: "tabular-nums" },
      { field: "lang", width: 70 },
      { field: "minutesToCash", headerName: "To cash", width: 100, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : duration(p.value)), cellClass: "tabular-nums" },
      { field: "payoutBatchId", headerName: "PayPal batch", width: 160, cellRenderer: MonoCell },
      { field: "createdAt", headerName: "Received", width: 130, valueFormatter: (p) => local(p.value), sort: "desc", cellClass: "tabular-nums" },
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
        theme={opsGridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ resizable: true }}
        getRowId={(p) => p.data.id}
        rowSelection={rowSelection}
        selectionColumnDef={{ pinned: "left", width: 48 }}
        groupDefaultExpanded={1}
        suppressAggFuncInHeader
        // Highest tier first, the order the agent pays in (P-8); without a sort, groups follow the first row.
        autoGroupColumnDef={{ headerName: "Tier", minWidth: 170, pinned: "left", sort: "desc" }}
        onGridReady={onGridReady}
        onSelectionChanged={onSelectionChanged}
        onRowClicked={onRowClicked}
        onCellValueChanged={onCellValueChanged}
      />
    </div>
  );
}
