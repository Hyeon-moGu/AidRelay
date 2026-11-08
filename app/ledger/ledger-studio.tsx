"use client";

// The public ledger's interactive report, built with AG Studio in view mode: our fund-progress and
// money-trail widgets (studio-widgets.tsx), grants by need, who approved the money, and every grant, all
// cross-filtered by clicking a chart, a slice or a payout. Every value comes from the anonymized ledger
// (lib/ledger/public.ts), so nothing here can carry PII.
import { useMemo, useState } from "react";
import { AgStudio } from "ag-studio-react";
import {
  AgStudioLicenseManager,
  studioTheme,
  type AgDataSourcesDefinition,
  type AgReportState,
  type AgResponsiveLayoutBreakpoint,
  type AgStudioLocaleText,
  type AgWidgetLayoutState,
} from "ag-studio";
import type { Ledger } from "@/lib/ledger/public";
import { duration } from "@/lib/format";
import { NEED_LABEL } from "@/lib/ledger/labels";
import { DESKTOP_LAYOUT, PHONE_MAX_WIDTH, PHONE_Y_SPANS, ROW_HEIGHT, TABLET_LAYOUT, TABLET_MAX_WIDTH, phoneLayout } from "./studio-layout";
import { ledgerWidgets } from "./studio-widgets";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC", timeZoneName: "short" });

const STATUS_LABEL: Record<string, string> = {
  paid: "Paid",
  paying: "On its way",
  approved: "Approved",
  parked: "Waiting for funds",
};

export const APPROVED_BY = { human: "Volunteer", agent: "AI case officer" } as const;

export type LedgerStudioData = Pick<Ledger, "rows" | "donations" | "fund">;

const SUMMARY_CHARS = 42;

/** Shortens a summary at a word boundary, so the column never ends mid-word. */
function clip(text: string): string {
  return text.length <= SUMMARY_CHARS ? text : `${text.slice(0, SUMMARY_CHARS).replace(/[\s,;:]+\S*$/, "")}…`;
}

/** The three tables the report reads. Dollars here are display values; the ledger itself keeps integer cents. */
export function ledgerDataSources(ledger: LedgerStudioData): AgDataSourcesDefinition {
  // Greatest need first, newest first within a level: the order the policy pays in (P-8). The chart takes
  // its category order from the data and the grid shows rows as given, so neither needs a sort of its own
  // (a sort would also put an arrow in the narrow Case header and truncate it).
  const byNeed = [...ledger.rows].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || b.receivedAt.localeCompare(a.receivedAt));
  const grants = byNeed.map((r) => {
    const dollars = (r.amountCents ?? 0) / 100;
    const paid = r.status === "paid";
    const parked = r.status === "parked";
    return {
      caseId: r.caseId,
      status: STATUS_LABEL[r.status] ?? r.status,
      need: r.tier == null ? "Not assessed" : (NEED_LABEL[r.tier] ?? `Level ${r.tier}`),
      amount: dollars,
      // Blank rather than 0, so the stacked chart draws (and labels) no empty segment.
      paid: paid ? dollars : null,
      committed: paid ? null : dollars,
      inFlight: !paid && !parked ? dollars : null,
      waiting: parked ? dollars : null,
      // 1 per family, so a sum counts them.
      families: 1,
      households: paid ? 1 : null,
      waitingFamilies: parked ? 1 : null,
      decidedBy: r.humanReviewed ? APPROVED_BY.human : APPROVED_BY.agent,
      zipPrefix: `${r.zipPrefix}xx`,
      payoutBatchId: r.payoutBatchId ?? "pending",
      // Text, so it reads "1 h 59 min" like the rest of the site.
      timeToCash: r.minutesToCash == null ? "" : duration(r.minutesToCash),
      // The grid sizes columns to their content and then scales them to the widget, so a 140-character
      // summary would squeeze every short column; the full text stays in /api/ledger.
      summary: clip(r.summary),
      receivedAt: new Date(r.receivedAt),
      paidAt: r.paidAt ? new Date(r.paidAt) : null,
    };
  });
  const donations = ledger.donations.map((d) => ({ captureId: d.captureId, amount: d.amountCents / 100, capturedAt: new Date(d.capturedAt) }));
  const money = (id: string, name: string, description: string) => ({ id, name, description, format: "currencyFormat", formatOptions: { format: usd } }) as const;
  return {
    description: "Public ledger of a disaster-relief fund: grants paid through PayPal Payouts and donations captured through PayPal Orders. Anonymized: no names, no addresses.",
    sources: [
      {
        id: "grants",
        name: "Grants",
        primaryKeyField: "caseId",
        data: grants,
        fields: [
          { id: "caseId", name: "Case", description: "The case id, issued in order of application.", format: "textFormat" },
          { id: "status", name: "Status", format: "textFormat", cardinality: "low" },
          { id: "need", name: "Need", description: "The policy's level of need, in words.", format: "textFormat", cardinality: "low" },
          // Cents in the table: a ledger reads to the cent, and the wider values keep the header from truncating.
          { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: { format: cents } },
          money("paid", "Paid", "Dollars paid to the family through PayPal Payouts."),
          money("committed", "Approved, not yet paid", "Dollars approved and not yet in the family's account."),
          money("inFlight", "On its way", "Dollars approved and being sent by PayPal."),
          money("waiting", "Waiting for funds", "Dollars approved for families waiting for more donations."),
          { id: "families", name: "Families", description: "1 per family; sum it to count families.", format: "integerFormat" },
          { id: "households", name: "Households paid", description: "1 per paid household; sum it to count them.", format: "integerFormat" },
          { id: "waitingFamilies", name: "Families waiting", description: "1 per family waiting for funds.", format: "integerFormat" },
          { id: "decidedBy", name: "Approved by", description: "A volunteer, or the AI case officer within the policy's limits.", format: "textFormat", cardinality: "low" },
          { id: "zipPrefix", name: "Zip", format: "textFormat", cardinality: "low" },
          { id: "payoutBatchId", name: "PayPal payout id", format: "textFormat" },
          { id: "timeToCash", name: "Time to cash", description: "From applying to money in the family's PayPal account.", format: "textFormat" },
          { id: "summary", name: "What happened", description: "The AI case officer's one-line public summary.", format: "textFormat" },
          { id: "receivedAt", name: "Applied", format: "dateTimeFormat", formatOptions: { format: when } },
          { id: "paidAt", name: "Paid at", format: "dateTimeFormat", formatOptions: { format: when } },
        ],
      },
      {
        id: "donations",
        name: "Donations",
        primaryKeyField: "captureId",
        data: donations,
        fields: [
          { id: "capturedAt", name: "When", format: "dateTimeFormat", formatOptions: { format: when } },
          { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: { format: cents } },
          { id: "captureId", name: "PayPal capture id", format: "textFormat" },
        ],
      },
      {
        // The fund's own total: the donations table lists only the most recent ones.
        id: "fund",
        name: "Fund",
        data: [{ raised: ledger.fund.raisedCents / 100 }],
        fields: [money("raised", "Raised", "Every donation the fund has captured.")],
      },
    ],
  };
}

const title = (text: string) => ({ title: { enabled: true, text } });

/** The authored report: 24 columns; the tablet and phone breakpoints below rearrange the same widgets. */
export function ledgerReport(): AgReportState {
  return {
    selectedPageId: "ledger",
    pages: [
      {
        id: "ledger",
        widgets: {
          fundProgress: {
            type: "fund-progress",
            format: title("Where the money is"),
            dataMapping: {
              raised: [{ id: "fund.raised", aggregation: "sum" }],
              paid: [{ id: "grants.paid", aggregation: "sum" }],
              inFlight: [{ id: "grants.inFlight", aggregation: "sum" }],
              waiting: [{ id: "grants.waiting", aggregation: "sum" }],
              households: [{ id: "grants.households", aggregation: "sum" }],
              waitingFamilies: [{ id: "grants.waitingFamilies", aggregation: "sum" }],
            },
          },
          byTier: {
            type: "column-chart-stacked",
            format: {
              ...title("Grants by level of need"),
              // Dollar labels on the bars (our en-US field format) instead of the value axis, which AG Studio
              // abbreviates in the browser's locale ("3천" in Korean) with no option to change it. Without its
              // labels the axis would leave bare gridlines, so those go too.
              style: {
                theme: { bar: { series: { label: { enabled: true } } } },
                custom: { valueAxis: { label: { color: "transparent" }, gridLine: { enabled: false }, line: { strokeWidth: 0 } } },
              },
            },
            dataMapping: {
              categoryKey: [{ id: "grants.need" }],
              valueKey: [
                { id: "grants.paid", aggregation: "sum" },
                { id: "grants.committed", aggregation: "sum" },
              ],
            },
          },
          decidedBy: {
            type: "donut-chart",
            // Families, not dollars, so it agrees with "paid without waiting for a volunteer" on the page.
            format: {
              ...title("Who said yes to each family"),
              style: {
                // Slices take the report palette in order, so sorting by name, descending, always gives
                // "Volunteer" the first color (green) and "AI case officer" the second (teal), the same pair
                // the grid's icons use. (Studio ignores per-widget fills for a donut.) No legend: each slice
                // is already labelled with its name and count.
                theme: { common: { legend: { enabled: false } } },
                custom: {
                  // "Volunteer (6)" beside each slice (not color alone), the total in the middle, and a gap between slices.
                  pieDataLabel: { enabled: true, position: "outside", format: "value", category: true },
                  totalLabel: { enabled: true, fontSize: 28, fontWeight: "bold" },
                  seriesStroke: { enabled: true, strokeWidth: 2 },
                },
              },
            },
            dataMapping: {
              categoryKey: [{ id: "grants.decidedBy" }],
              valueKey: [{ id: "grants.families", aggregation: "sum" }],
            },
            sort: [{ field: { id: "grants.decidedBy" }, direction: "desc" }],
          },
          moneyTrail: {
            type: "money-trail",
            format: title("Money in, money out"),
            dataMapping: {
              donationTime: [{ id: "donations.capturedAt" }],
              donationAmount: [{ id: "donations.amount" }],
              captureId: [{ id: "donations.captureId" }],
              caseId: [{ id: "grants.caseId" }],
              paidAt: [{ id: "grants.paidAt" }],
              amount: [{ id: "grants.amount" }],
              need: [{ id: "grants.need" }],
              decidedBy: [{ id: "grants.decidedBy" }],
              timeToCash: [{ id: "grants.timeToCash" }],
              payoutId: [{ id: "grants.payoutBatchId" }],
            },
          },
          grants: {
            type: "grid",
            // A total row, and a brief flash on any amount that changes when the ledger refreshes.
            format: { ...title("Every grant"), style: { columnAutoSize: true, grandTotalRow: { enabled: true }, animateValueChanges: true } },
            dataMapping: {
              cols: [
                { id: "grants.caseId" },
                { id: "grants.status" },
                { id: "grants.amount" },
                { id: "grants.need" },
                { id: "grants.decidedBy" },
                { id: "grants.timeToCash" },
                { id: "grants.payoutBatchId" },
                { id: "grants.summary" },
              ],
            },
          },
        },
        widgetLayout: DESKTOP_LAYOUT,
      },
    ],
    // Our widget types are not in AgReportState's default registry.
  } as unknown as AgReportState;
}

/** Phone layout: everything full width, in the authored order (studio-layout.ts). */
const PHONE: AgResponsiveLayoutBreakpoint = {
  maxWidth: PHONE_MAX_WIDTH,
  layout: (candidates, { columns }): AgWidgetLayoutState[] => phoneLayout(candidates.map((c) => c.layout), columns, PHONE_Y_SPANS),
};

/** Tablet layout: the two charts side by side, the money trail full width under them. */
const TABLET: AgResponsiveLayoutBreakpoint = {
  maxWidth: TABLET_MAX_WIDTH,
  layout: (): AgWidgetLayoutState[] => TABLET_LAYOUT,
};

// Studio's words for its own overlays and tooltips, in the page's voice.
const LOCALE: AgStudioLocaleText = {
  widgetOverlayNoData: "No grants match this selection. Select it again to show every grant.",
  aggregationSumFieldName: "${name}",
  aggregationCountFieldName: "${name}",
  crossFilterSumFieldName: "${name}, selected",
  crossFilterCountFieldName: "${name}, selected",
} as AgStudioLocaleText;

// The report sits on the page background; each widget is a card drawn like the page's own cards.
export const ledgerTheme = studioTheme.withParams({
  fontFamily: "inherit",
  backgroundColor: "var(--card)",
  foregroundColor: "var(--foreground)",
  subtleTextColor: "var(--muted-foreground)",
  borderColor: "var(--border)",
  accentColor: "var(--primary)",
  browserColorScheme: "inherit",
  // Let the canvas shrink to phone widths so the responsive breakpoints below can apply.
  studioMinWidth: 0,
  studioCanvasMinWidth: 0,
  studioWrapperBackgroundColor: "transparent",
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioCanvasBorder: false,
  studioCanvasShadow: "none",
  studioCanvasBackgroundColor: "transparent",
  studioCanvasPadding: 0,
  studioWidgetBackgroundColor: "var(--card)",
  studioWidgetBorderRadius: 16,
  studioWidgetShadow: "0 0 0 1px var(--border)",
  // Despite the name, this is the inset around each widget (half the gutter between cards); globals.css
  // .ledger-report pads the inside of each card.
  studioWidgetPadding: 6,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: "var(--foreground)",
  scrollbarTrackColor: "transparent",
  scrollbarThumbColor: "var(--border)",
  chartPaletteFills1Color: "var(--bar-paid)",
  chartPaletteFills2Color: "var(--bar-reserved)",
  chartPaletteFills3Color: "var(--warning)",
  chartPaletteFills4Color: "var(--wait)",
  chartPaletteStrokes1Color: "var(--bar-paid)",
  chartPaletteStrokes2Color: "var(--bar-reserved)",
  chartPaletteStrokes3Color: "var(--warning)",
  chartPaletteStrokes4Color: "var(--wait)",
});

let licensed = false;

export function LedgerStudio({ ledger, licenseKey }: { ledger: LedgerStudioData; licenseKey: string }) {
  if (licenseKey && !licensed) {
    AgStudioLicenseManager.setLicenseKey(licenseKey);
    licensed = true;
  }
  const data = useMemo(() => ledgerDataSources(ledger), [ledger]);
  const [initialState] = useState(ledgerReport);
  return (
    <AgStudio
      style={{ width: "100%", height: "100%" }}
      mode="view"
      theme={ledgerTheme}
      data={data}
      initialState={initialState}
      widgets={ledgerWidgets}
      localeText={LOCALE}
      responsiveLayoutBreakpoints={[PHONE, TABLET]}
      layout={{ rowHeight: ROW_HEIGHT }}
      panels={{ view: { left: [], right: [] } }}
    />
  );
}
