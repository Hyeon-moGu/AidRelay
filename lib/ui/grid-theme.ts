// AG Grid themes built on the app's CSS variables, so both grids follow Relay teal and the OS dark mode.
import { themeQuartz } from "ag-grid-community";

const shared = {
  fontFamily: "inherit",
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  textColor: "var(--foreground)",
  subtleTextColor: "var(--muted-foreground)",
  borderColor: "var(--border)",
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 500,
  accentColor: "var(--primary)",
  rowHoverColor: "color-mix(in srgb, var(--primary) 6%, transparent)",
  selectedRowBackgroundColor: "color-mix(in srgb, var(--primary) 11%, transparent)",
  browserColorScheme: "inherit",
  wrapperBorderRadius: 12,
  borderRadius: 6,
  checkboxCheckedBackgroundColor: "var(--primary)",
  checkboxCheckedShapeColor: "var(--primary-foreground)",
  checkboxUncheckedBorderColor: "var(--input)",
} as const;

/** Public ledger: roomy rows, read-only. */
export const ledgerGridTheme = themeQuartz.withParams({ ...shared, fontSize: 13.5, headerFontSize: 12.5, rowHeight: 46, headerHeight: 40 });

/** Operator queue: denser, the same tokens. */
export const opsGridTheme = themeQuartz.withParams({ ...shared, fontSize: 13, headerFontSize: 12, rowHeight: 40, headerHeight: 38, spacing: 7 });
