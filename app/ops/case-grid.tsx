"use client";

// The queue: AG Grid Enterprise. Row grouping by tier with group totals, the row group panel (drag Status up
// to regroup), the columns and filters tool panels, set and number filters, a status bar with a custom panel
// that totals the selected grants, multi-row selection and inline amount edit.
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
  type SideBarDef,
  type StatusBar,
} from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact, type CustomStatusPanelProps } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

/**
 * Status bar panel: how many grants are selected and what approving them would pay, with the amounts as they
 * stand in the grid (an edited amount counts at once). It is what a volunteer checks before a bulk approval.
 * Only cases still open for a decision count toward the total; a paid or rejected row in the selection is named apart.
 */
function SelectedTotal({ api }: CustomStatusPanelProps<GridRow>) {
  const [sel, setSel] = useState({ count: 0, dollars: 0, unpriced: 0, closed: 0 });
  useEffect(() => {
    const update = () => {
      const rows = api.getSelectedRows();
      const open = rows.filter((r) => EDITABLE.has(r.status));
      setSel({
        count: rows.length,
        dollars: open.reduce((sum, r) => sum + (r.amountDollars ?? 0), 0),
        unpriced: open.filter((r) => r.amountDollars == null).length,
        closed: rows.length - open.length,
      });
    };
    const events = ["selectionChanged", "cellValueChanged", "modelUpdated"] as const;
    for (const e of events) api.addEventListener(e, update);
    update();
    return () => {
      if (api.isDestroyed()) return;
      for (const e of events) api.removeEventListener(e, update);
    };
  }, [api]);
  return (
    <div className="ag-status-name-value tabular-nums" aria-live="polite">
      {sel.count === 0 ? (
        <span>Select grants to approve them together</span>
      ) : (
        <>
          <span>Selected:</span> <span className="ag-status-name-value-value">{sel.count}</span>
          <span className="ml-3">Total to approve:</span> <span className="ag-status-name-value-value">{dollars(sel.dollars)}</span>
          {sel.unpriced > 0 && <span className="ml-3">{sel.unpriced} without an amount yet</span>}
          {sel.closed > 0 && <span className="ml-3">{sel.closed} already paid or closed</span>}
        </>
      )}
    </div>
  );
}

const STATUS_BAR: StatusBar = {
  statusPanels: [
    { statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" },
    { statusPanel: SelectedTotal, align: "right" },
  ],
};

/** Columns and filters tool panels. No pivot mode: the queue is a list of cases, not a report. */
const SIDE_BAR: SideBarDef = {
  toolPanels: [
    {
      id: "columns",
      labelDefault: "Columns",
      labelKey: "columns",
      iconKey: "columns",
      toolPanel: "agColumnsToolPanel",
      toolPanelParams: { suppressPivotMode: true, suppressPivots: true, suppressValues: true },
    },
    { id: "filters", labelDefault: "Filters", labelKey: "filters", iconKey: "filter", toolPanel: "agFiltersToolPanel" },
  ],
};

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
      { field: "tier", rowGroup: true, enableRowGroup: true, hide: true, filter: "agSetColumnFilter", valueFormatter: (p) => (p.value == null ? "Not yet tiered" : `Tier ${p.value}`) },
      { field: "id", headerName: "Case", width: 115, pinned: "left", cellRenderer: MonoCell },
      { field: "status", width: 150, cellRenderer: StatusCell, filter: "agSetColumnFilter", enableRowGroup: true },
      {
        field: "amountDollars",
        headerName: "Amount",
        width: 115,
        type: "rightAligned",
        filter: "agNumberColumnFilter",
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
      {
        field: "redFlags",
        headerName: "Flags",
        width: 180,
        cellRenderer: FlagsCell,
        autoHeight: true,
        // Text form for filtering, copy and export; AG Grid 36 also warns (#48) when an array column has none.
        valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(", ") : ""),
      },
      { field: "requestedAmountCents", headerName: "Requested", width: 110, type: "rightAligned", valueFormatter: (p) => money(p.value), cellClass: "tabular-nums" },
      { field: "confidence", width: 105, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : `${Math.round(p.value * 100)}%`), cellClass: "tabular-nums" },
      { field: "secondEvaluationAgrees", headerName: "2nd eval", width: 95, cellRenderer: SecondEvalCell, enableRowGroup: true },
      { field: "ledgerSummary", headerName: "AI summary", flex: 1, minWidth: 240, tooltipField: "ledgerSummary" },
      // Hidden at first so the decision columns fit a laptop screen; each one is a click away in the Columns panel.
      { field: "zip", width: 85, cellClass: "tabular-nums", hide: true },
      { field: "householdSize", headerName: "HH", width: 68, type: "rightAligned", cellClass: "tabular-nums", hide: true },
      { field: "lang", width: 70, filter: "agSetColumnFilter", enableRowGroup: true, hide: true },
      { field: "minutesToCash", headerName: "To cash", width: 100, type: "rightAligned", valueFormatter: (p) => (p.value == null ? "" : duration(p.value)), cellClass: "tabular-nums" },
      { field: "payoutBatchId", headerName: "PayPal batch", width: 160, cellRenderer: MonoCell },
      { field: "createdAt", headerName: "Received", width: 130, valueFormatter: (p) => local(p.value), sort: "desc", cellClass: "tabular-nums", hide: true },
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
    <div className="h-[680px] w-full">
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
        // Grouped by tier to start with; dragging Status (or another column) into the panel regroups the queue.
        rowGroupPanelShow="always"
        statusBar={STATUS_BAR}
        sideBar={SIDE_BAR}
        // Highest tier first, the order the agent pays in (P-8); without a sort, groups follow the first row.
        autoGroupColumnDef={{ headerName: "Group", width: 140, minWidth: 120, pinned: "left", sort: "desc" }}
        onGridReady={onGridReady}
        onSelectionChanged={onSelectionChanged}
        onRowClicked={onRowClicked}
        onCellValueChanged={onCellValueChanged}
      />
    </div>
  );
}
