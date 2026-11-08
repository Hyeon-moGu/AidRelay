// Layout of the AG Studio ledger report, kept apart from ledger-studio.tsx so the lazy wrapper can size the
// report without pulling AG Studio into the page's first bundle. Plain data and pure functions only.

export interface Box {
  xTrack: number;
  yTrack: number;
  xSpan: number;
  ySpan: number;
}

/** Canvas row height in px, and the column count the report is authored in. */
export const ROW_HEIGHT = 20;
export const COLUMNS = 24;
/** Canvas widths up to this use the phone layout. */
export const PHONE_MAX_WIDTH = 600;
/** Canvas widths up to this (and above the phone range) use the tablet layout. */
export const TABLET_MAX_WIDTH = 1060;
/** Extra px around the canvas: the widget inset above the first row and below the last (2 x 6px), plus slack. */
export const CANVAS_PADDING = 16;

/** The authored desktop layout, in widget order (the report lists its widgets in this order). */
export const DESKTOP_LAYOUT = {
  fundProgress: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 10 },
  byTier: { xTrack: 0, yTrack: 10, xSpan: 7, ySpan: 16 },
  decidedBy: { xTrack: 7, yTrack: 10, xSpan: 8, ySpan: 16 },
  moneyTrail: { xTrack: 15, yTrack: 10, xSpan: 9, ySpan: 16 },
  grants: { xTrack: 0, yTrack: 26, xSpan: 24, ySpan: 21 },
} satisfies Record<string, Box>;

type WidgetId = keyof typeof DESKTOP_LAYOUT;
const ORDER = Object.keys(DESKTOP_LAYOUT) as WidgetId[];

/** Tablet: the charts share a row at half width each, and the money trail gets a full-width row. */
const TABLET: Record<WidgetId, Box> = {
  fundProgress: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 10 },
  byTier: { xTrack: 0, yTrack: 10, xSpan: 12, ySpan: 16 },
  decidedBy: { xTrack: 12, yTrack: 10, xSpan: 12, ySpan: 16 },
  moneyTrail: { xTrack: 0, yTrack: 26, xSpan: 24, ySpan: 14 },
  grants: { xTrack: 0, yTrack: 40, xSpan: 24, ySpan: 21 },
};
export const TABLET_LAYOUT: Box[] = ORDER.map((k) => TABLET[k]);

/** Phone heights that differ from desktop: the four fund figures wrap to two rows on a phone. */
const PHONE_Y_SPAN: Partial<Record<WidgetId, number>> = { fundProgress: 14, moneyTrail: 20 };
/** The same overrides by widget position. */
export const PHONE_Y_SPANS = ORDER.map((k) => PHONE_Y_SPAN[k]);

/**
 * Phone layout: small widgets two per row, everything else full width, in the authored order.
 * Rows take the height of their tallest widget.
 */
export function phoneLayout(boxes: Box[], columns: number, ySpans: Array<number | undefined> = []): Box[] {
  const out: Box[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  boxes.forEach((b, i) => {
    const xSpan = b.xSpan <= columns / 4 ? columns / 2 : columns;
    const ySpan = ySpans[i] ?? b.ySpan;
    if (x + xSpan > columns) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    out.push({ xTrack: x, yTrack: y, xSpan, ySpan });
    x += xSpan;
    rowHeight = Math.max(rowHeight, ySpan);
  });
  return out;
}

const rowsUsed = (boxes: Box[]) => Math.max(...boxes.map((b) => b.yTrack + b.ySpan));
export const DESKTOP_ROWS = rowsUsed(Object.values(DESKTOP_LAYOUT));
export const TABLET_ROWS = rowsUsed(TABLET_LAYOUT);
export const PHONE_ROWS = rowsUsed(phoneLayout(Object.values(DESKTOP_LAYOUT), COLUMNS, PHONE_Y_SPANS));

export function reportHeight(width: number): number {
  const rows = width <= PHONE_MAX_WIDTH ? PHONE_ROWS : width <= TABLET_MAX_WIDTH ? TABLET_ROWS : DESKTOP_ROWS;
  return rows * ROW_HEIGHT + CANVAS_PADDING;
}
