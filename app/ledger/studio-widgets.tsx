"use client";

// AidRelay's own AG Studio widgets for the public ledger, plus cell renderers for the built-in grid.
// - "fund-progress": where the raised money is, as one bar: paid, on its way, waiting for funds, not yet
//   granted. A chart or payout selection fades the bar and keeps the selected share solid, using Studio's
//   cross-filter highlight; when approved families are waiting for money it says how much would pay them.
// - "money-trail": donations in and payouts out on one timeline, newest first, with how long each payout
//   took and which payouts followed a donation. Clicking a payout cross-filters the report to that case; any
//   selection dims the payouts outside it, the way Studio's charts highlight.
// Both read their numbers through widgetApi.getData from the same anonymized tables as the built-in widgets.
import { ArrowRight, Bot, HandCoins, Send, UserCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createWidgets, type AgWidgetCustomCellRendererProps, type AgWidgetDefinition } from "ag-studio-react";
import type {
  AgWidgetApi,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetDataResponse,
  AgWidgetField,
  AgWidgetFieldReference,
  AgWidgetParams,
  AgWidgetsConfig,
} from "ag-studio";
import { cn } from "cn";
import { NEED_LABEL } from "@/lib/ledger/labels";

const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");
const utcDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const plural = (n: number, one: string, many: string) => `${count.format(n)} ${n === 1 ? one : many}`;
const defined = <T,>(x: T | undefined): x is T => x !== undefined;

/** Studio's loading overlay while the first answer is on its way; later refreshes keep the content visible. */
function useLoading(widgetApi: AgWidgetApi, ready: boolean) {
  useEffect(() => {
    widgetApi.setDisplayState(ready ? "displayed" : "loading", ready ? undefined : { prominent: false });
  }, [widgetApi, ready]);
}

// ---------------------------------------------------------------------------------------------------------
// Fund progress

type FundProgressMapping = {
  raised?: AgWidgetFieldReference[];
  paid?: AgWidgetFieldReference[];
  inFlight?: AgWidgetFieldReference[];
  waiting?: AgWidgetFieldReference[];
  households?: AgWidgetFieldReference[];
  waitingFamilies?: AgWidgetFieldReference[];
};
export type FundProgressState = AgWidgetData<FundProgressMapping, AgWidgetDataFormat<unknown>> & { type: "fund-progress" };

interface Totals {
  paid: number;
  inFlight: number;
  waiting: number;
  households: number;
  waitingFamilies: number;
}
type GrantFields = Partial<Record<keyof Totals, AgWidgetField>>;

function totalsOf(rows: Record<string, unknown>[] | undefined, f: GrantFields): Totals {
  const row = rows?.[0] ?? {};
  const read = (k: keyof Totals) => (f[k] ? num(row[f[k].key]) : 0);
  return { paid: read("paid"), inFlight: read("inFlight"), waiting: read("waiting"), households: read("households"), waitingFamilies: read("waitingFamilies") };
}

function FundProgress({ widgetApi, dataMapping }: AgWidgetParams<FundProgressState>) {
  const fields = useMemo(
    () => ({
      raised: dataMapping.raised?.[0],
      grants: {
        paid: dataMapping.paid?.[0],
        inFlight: dataMapping.inFlight?.[0],
        waiting: dataMapping.waiting?.[0],
        households: dataMapping.households?.[0],
        waitingFamilies: dataMapping.waitingFamilies?.[0],
      } satisfies GrantFields,
    }),
    [dataMapping],
  );
  const [raised, setRaised] = useState<number>();
  const [all, setAll] = useState<Totals>();
  const [selected, setSelected] = useState<Totals | null>(null);
  useLoading(widgetApi, raised !== undefined && all !== undefined);

  useEffect(() => {
    let live = true;
    const grantFields = Object.values(fields.grants).filter(defined);
    const onRaised = (r: AgWidgetDataResponse) => {
      if (live && !r.replaced) setRaised(fields.raised ? num(r.results.rows[0]?.[fields.raised.key]) : 0);
    };
    const onGrants = (r: AgWidgetDataResponse) => {
      if (!live || r.replaced) return;
      setAll(totalsOf(r.results.rows, fields.grants));
      // With a selection anywhere in the report, `crossFilter` holds the same totals for the selected rows.
      setSelected(r.crossFilter ? totalsOf(r.crossFilter.rows, fields.grants) : null);
    };
    if (fields.raised) void widgetApi.getData({ fields: [fields.raised] }, { queryId: "raised", crossFilter: "none", onDataUpdated: onRaised }).then(onRaised);
    if (grantFields.length) void widgetApi.getData({ fields: grantFields }, { queryId: "grants", crossFilter: "highlight", onDataUpdated: onGrants }).then(onGrants);
    return () => {
      live = false;
    };
  }, [widgetApi, fields]);

  if (raised === undefined || !all) return null;
  const available = raised - all.paid - all.inFlight;
  const shortfall = Math.max(0, all.waiting - available);
  const notGranted = Math.max(0, available - all.waiting);
  const scale = Math.max(raised, all.paid + all.inFlight + all.waiting, 1);
  const pct = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  const empty = selected !== null && selected.paid + selected.inFlight + selected.waiting === 0;

  return (
    <div className="flex h-full flex-col justify-end gap-4 px-2 pb-1">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure label="Raised" value={whole.format(raised)} />
        <Figure label="Paid to families" dot="bg-bar-paid" value={whole.format(all.paid)} sub={plural(all.households, "household", "households")} />
        <Figure label="On its way" dot="bg-bar-reserved" value={whole.format(all.inFlight)} sub={all.inFlight > 0 ? "approved, PayPal is sending it" : "nothing in transit right now"} />
        {all.waiting > 0 ? (
          <Figure label="Waiting for funds" dot="bar-waiting" value={whole.format(all.waiting)} sub={plural(all.waitingFamilies, "approved family", "approved families")} />
        ) : (
          <Figure label="Available" dot="bg-bar-available ring-1 ring-input/70 ring-inset" value={whole.format(notGranted)} sub={raised > 0 ? `${Math.round((notGranted / raised) * 100)}% of the fund` : undefined} />
        )}
      </dl>
      <div>
        <div
          role="img"
          aria-label={`Of ${whole.format(raised)} raised: ${whole.format(all.paid)} paid, ${whole.format(all.inFlight)} on its way, ${whole.format(all.waiting)} approved and waiting for funds, ${whole.format(notGranted)} available.`}
          className="relative flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-bar-available ring-1 ring-input/50 ring-inset"
        >
          {/* Like Studio's own charts: with a selection, everything fades and the selected share stays solid. */}
          {(
            [
              ["paid", all.paid, "bg-bar-paid"],
              ["inFlight", all.inFlight, "bg-bar-reserved"],
              ["waiting", all.waiting, "bar-waiting"],
            ] as const
          ).map(([k, v, cls]) =>
            v > 0 ? <span key={k} className={cn("h-full transition-[width,opacity] duration-500 ease-out", cls, selected && "opacity-30")} style={{ width: pct(v) }} /> : null,
          )}
          {selected && (
            <>
              <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-bar-paid" style={{ width: pct(selected.paid) }} />
              <span aria-hidden="true" className="absolute inset-y-0 bg-bar-reserved" style={{ left: pct(all.paid), width: pct(selected.inFlight) }} />
              <span aria-hidden="true" className="bar-waiting absolute inset-y-0" style={{ left: pct(all.paid + all.inFlight), width: pct(selected.waiting) }} />
            </>
          )}
        </div>
        <p aria-live="polite" className="mt-2 min-h-5 text-[13px] text-muted-foreground">
          {empty ? (
            "Nothing matches both selections. Select one of them again to clear it."
          ) : selected ? (
            <>
              <span className="mr-1.5 inline-block size-2 rounded-full bg-bar-paid align-middle" aria-hidden="true" />
              Your selection: <strong className="font-semibold text-foreground">{whole.format(selected.paid)}</strong> paid to{" "}
              {plural(selected.households, "household", "households")}
              {all.paid > 0 && selected.paid > 0 && `, ${Math.round((selected.paid / all.paid) * 100)}% of everything paid so far`}
              {selected.inFlight > 0 && `, plus ${whole.format(selected.inFlight)} on its way`}
              {selected.waiting > 0 && `, plus ${whole.format(selected.waiting)} waiting for funds`}.
            </>
          ) : shortfall > 0 ? (
            <>
              {plural(all.waitingFamilies, "approved family is", "approved families are")} waiting. A donation of{" "}
              <strong className="font-semibold text-foreground">{whole.format(shortfall)}</strong> would pay {all.waitingFamilies === 1 ? "them" : "all of them"}{" "}
              now.{" "}
              <a href="/donate" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Donate
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </a>
            </>
          ) : (
            "Select a bar, a slice or a payout below to see its share of the fund."
          )}
        </p>
      </div>
    </div>
  );
}

function Figure({ label, value, sub, dot }: { label: string; value: string; sub?: string; dot?: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {dot && <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 text-2xl font-semibold tracking-[-0.03em] tabular-nums sm:text-[1.75rem]">{value}</dd>
      {sub && <dd className="truncate text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Money trail

type MoneyTrailMapping = {
  donationTime?: AgWidgetFieldReference[];
  donationAmount?: AgWidgetFieldReference[];
  captureId?: AgWidgetFieldReference[];
  caseId?: AgWidgetFieldReference[];
  paidAt?: AgWidgetFieldReference[];
  amount?: AgWidgetFieldReference[];
  need?: AgWidgetFieldReference[];
  decidedBy?: AgWidgetFieldReference[];
  timeToCash?: AgWidgetFieldReference[];
  payoutId?: AgWidgetFieldReference[];
};
export type MoneyTrailState = AgWidgetData<MoneyTrailMapping, AgWidgetDataFormat<unknown>> & { type: "money-trail" };

interface Donation {
  kind: "in";
  key: string;
  at: number;
  amount: number;
  captureId: string;
  followedBy: number;
}
interface Payout {
  kind: "out";
  key: string;
  at: number;
  amount: number;
  caseId: string;
  payoutId: string;
  need: string;
  volunteer: boolean;
  timeToCash: string;
  afterDonation?: { seconds: number; amount: number };
}

/** "a displaced family" from the need label the ledger shows. */
const WHO: Record<string, string> = {
  [NEED_LABEL[1]]: "a family with minor losses",
  [NEED_LABEL[2]]: "a family whose home was damaged",
  [NEED_LABEL[3]]: "a displaced family",
  [NEED_LABEL[4]]: "a displaced family with high needs",
};

/** A payout this soon after a donation is shown as following it. */
const FOLLOWS_WITHIN_MS = 5 * 60_000;
/** Every donation stays on the trail; payouts are capped to the most recent. */
const MAX_PAYOUTS = 20;

function when(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${utcDay.format(at)} UTC`;
}

const gap = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
const toMs = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v === "string" && v ? Date.parse(v) : null);
const str = (row: Record<string, unknown>, f: AgWidgetField | undefined) => String((f && row[f.key]) ?? "");

function MoneyTrail({ widgetApi, dataMapping }: AgWidgetParams<MoneyTrailState>) {
  const f = useMemo(
    () => ({
      donationTime: dataMapping.donationTime?.[0],
      donationAmount: dataMapping.donationAmount?.[0],
      captureId: dataMapping.captureId?.[0],
      caseId: dataMapping.caseId?.[0],
      paidAt: dataMapping.paidAt?.[0],
      amount: dataMapping.amount?.[0],
      need: dataMapping.need?.[0],
      decidedBy: dataMapping.decidedBy?.[0],
      timeToCash: dataMapping.timeToCash?.[0],
      payoutId: dataMapping.payoutId?.[0],
    }),
    [dataMapping],
  );
  const [donationRows, setDonationRows] = useState<Record<string, unknown>[]>();
  const [payoutRows, setPayoutRows] = useState<Record<string, unknown>[]>();
  /** Case ids inside the current cross filter, or null when nothing is selected. */
  const [inSelection, setInSelection] = useState<Set<string> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useLoading(widgetApi, donationRows !== undefined && payoutRows !== undefined);

  useEffect(() => {
    let live = true;
    const inFields = [f.donationTime, f.donationAmount, f.captureId].filter(defined);
    const outFields = [f.caseId, f.paidAt, f.amount, f.need, f.decidedBy, f.timeToCash, f.payoutId].filter(defined);
    const onIn = (r: AgWidgetDataResponse) => {
      if (live && !r.replaced) setDonationRows(r.results.rows);
    };
    const onOut = (r: AgWidgetDataResponse) => {
      if (!live || r.replaced) return;
      setPayoutRows(r.results.rows);
      const key = f.caseId?.key;
      setInSelection(r.crossFilter && key ? new Set(r.crossFilter.rows.map((row) => String(row[key]))) : null);
    };
    void widgetApi.getData({ fields: inFields }, { queryId: "in", crossFilter: "none", onDataUpdated: onIn }).then(onIn);
    void widgetApi.getData({ fields: outFields }, { queryId: "out", crossFilter: "highlight", onDataUpdated: onOut }).then(onOut);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      window.clearInterval(tick);
    };
  }, [widgetApi, f]);

  const events = useMemo<Array<Donation | Payout>>(() => {
    if (!donationRows || !payoutRows) return [];
    const donations: Donation[] = donationRows
      .map((r) => ({ kind: "in" as const, key: `in-${str(r, f.captureId)}`, at: toMs(f.donationTime && r[f.donationTime.key]) ?? 0, amount: num(f.donationAmount && r[f.donationAmount.key]), captureId: str(r, f.captureId), followedBy: 0 }))
      .filter((d) => d.at > 0)
      .sort((a, b) => a.at - b.at);
    const payouts: Payout[] = payoutRows
      .flatMap((r) => {
        const at = toMs(f.paidAt && r[f.paidAt.key]);
        if (!at) return [];
        const caseId = str(r, f.caseId);
        return [
          {
            kind: "out" as const,
            key: `out-${caseId}`,
            at,
            amount: num(f.amount && r[f.amount.key]),
            caseId,
            payoutId: str(r, f.payoutId),
            need: str(r, f.need),
            volunteer: str(r, f.decidedBy).startsWith("Volunteer"),
            timeToCash: str(r, f.timeToCash),
          },
        ];
      })
      .sort((a, b) => a.at - b.at);
    // Each donation is linked to the payouts that went out within a few minutes of it; only the first of
    // them carries the "after the donation" line, so the trail does not repeat it.
    for (const d of donations) {
      const next = donations.find((x) => x.at > d.at)?.at ?? Infinity;
      const following = payouts.filter((p) => p.at >= d.at && p.at < next && p.at - d.at <= FOLLOWS_WITHIN_MS);
      d.followedBy = following.length;
      if (following[0]) following[0].afterDonation = { seconds: (following[0].at - d.at) / 1000, amount: d.amount };
    }
    return [...donations, ...payouts.slice(-MAX_PAYOUTS)].sort((a, b) => b.at - a.at);
  }, [donationRows, payoutRows, f]);

  // New rows slide in when the ledger refreshes; the first render shows everything at rest.
  const seen = useRef<Set<string> | null>(null);
  const fresh = useMemo(() => {
    const before = seen.current;
    const keys = new Set(events.map((e) => e.key));
    seen.current = keys;
    return before ? new Set([...keys].filter((k) => !before.has(k))) : new Set<string>();
  }, [events]);

  const selectedCase = useMemo(() => {
    const sel = widgetApi.getCrossFilterSelections()?.find((s) => s.type === "value");
    return sel && sel.type === "value" ? String(sel.values[0] ?? "") : null;
    // Re-read whenever the data comes back, which Studio does after every cross-filter change.
  }, [widgetApi, payoutRows]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!donationRows || !payoutRows) return null;
  if (events.length === 0) return <p className="px-2 text-sm text-muted-foreground">No money has moved yet. The first donation will appear here within seconds.</p>;

  return (
    <ol className="h-full space-y-1 overflow-y-auto px-1 pb-2">
      {events.map((e) =>
        e.kind === "in" ? (
          <li key={e.key} className={cn("flex gap-3 rounded-xl px-2 py-2", fresh.has(e.key) && "animate-relay-in")}>
            <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <HandCoins className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">
                  <span className="tabular-nums">{whole.format(e.amount)}</span> donated
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(e.at, now)}</span>
              </p>
              {e.followedBy > 0 && (
                <p className="mt-0.5">
                  <span className="inline-flex rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                    {plural(e.followedBy, "payout", "payouts")} went out in the next {gap(FOLLOWS_WITHIN_MS)}
                  </span>
                </p>
              )}
              <p className="truncate font-mono text-[11.5px] text-muted-foreground" translate="no">
                PayPal capture {e.captureId}
              </p>
            </div>
          </li>
        ) : (
          <TrailPayout
            key={e.key}
            e={e}
            now={now}
            fresh={fresh.has(e.key)}
            selected={selectedCase === e.caseId}
            // Outside another widget's selection: dimmed, and not a target (it would select nothing).
            outside={!!inSelection && !inSelection.has(e.caseId)}
            locked={!!inSelection && !inSelection.has(e.caseId) && !selectedCase}
            onSelect={() => f.caseId && widgetApi.toggleCrossFilter({ type: "value", field: f.caseId, value: e.caseId, group: 0 })}
          />
        ),
      )}
    </ol>
  );
}

function TrailPayout({ e, now, fresh, selected, outside, locked, onSelect }: { e: Payout; now: number; fresh: boolean; selected: boolean; outside: boolean; locked: boolean; onSelect: () => void }) {
  return (
    <li className={cn(fresh && "animate-relay-in")}>
      <button
        type="button"
        onClick={locked ? undefined : onSelect}
        aria-pressed={selected}
        aria-disabled={locked || undefined}
        className={cn(
          "flex w-full gap-3 rounded-xl px-2 py-2 text-left transition-[background-color,opacity]",
          !locked && "hover:bg-muted/70",
          selected && "bg-success-soft hover:bg-success-soft",
          outside && !selected && "opacity-40",
          locked && "cursor-default",
        )}
      >
        <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
          <Send className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="font-semibold tabular-nums">{whole.format(e.amount)}</span> to {WHO[e.need] ?? "a family"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{when(e.at, now)}</span>
          </span>
          {/* The proof of the whole product, so it gets the second line and full size. */}
          {e.afterDonation && (
            <span className="mt-0.5 block truncate text-sm font-medium text-success">
              Paid {gap(e.afterDonation.seconds * 1000)} after the {whole.format(e.afterDonation.amount)} donation came in
            </span>
          )}
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {e.volunteer ? "Volunteer approved" : "AI case officer approved"}
            {e.timeToCash && `, paid ${e.timeToCash} after applying`}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground" translate="no">
            {e.caseId}
            {e.payoutId && ` · ${e.payoutId}`}
          </span>
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Cell renderers for the built-in "Every grant" grid

const STATUS_TONE: Record<string, string> = {
  Paid: "bg-success-soft text-success",
  "On its way": "bg-accent text-accent-foreground",
  Approved: "bg-accent text-accent-foreground",
  "Waiting for funds": "bg-wait-soft text-wait",
};

function StatusCell({ value }: AgWidgetCustomCellRendererProps) {
  if (value == null || value === "") return null;
  return <span className={cn("inline-flex rounded-full px-1.5 py-0.5 text-[12px] leading-4 font-medium", STATUS_TONE[String(value)] ?? "bg-muted")}>{String(value)}</span>;
}

function ApprovedByCell({ value }: AgWidgetCustomCellRendererProps) {
  if (value == null || value === "") return null;
  const volunteer = String(value).startsWith("Volunteer");
  const Icon = volunteer ? UserCheck : Bot;
  return (
    <span className="inline-flex items-center gap-1">
      {/* The donut's colors: green for a volunteer, teal for the AI case officer. */}
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", volunteer ? "text-success" : "text-primary")} />
      {String(value)}
    </span>
  );
}

function MonoCell({ value }: AgWidgetCustomCellRendererProps) {
  return value == null ? null : (
    <span className="font-mono text-[12px]" translate="no">
      {String(value)}
    </span>
  );
}

const CELL_RENDERERS: Record<string, React.ComponentType<AgWidgetCustomCellRendererProps>> = {
  "grants.status": StatusCell,
  "grants.decidedBy": ApprovedByCell,
  "grants.payoutBatchId": MonoCell,
};

// ---------------------------------------------------------------------------------------------------------
// Registration

const FUND_PROGRESS: AgWidgetDefinition<"fund-progress", FundProgressState> = {
  id: "fund-progress",
  label: "Fund progress",
  dataMapping: {
    raised: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Total money raised." },
    paid: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "Money paid out to families." },
    inFlight: { type: "field", supportedRoles: ["numeric"], aiDescription: "Money approved and being sent by PayPal." },
    waiting: { type: "field", supportedRoles: ["numeric"], aiDescription: "Money approved for families who are waiting for more donations." },
    households: { type: "field", supportedRoles: ["numeric"], aiDescription: "Number of households paid." },
    waitingFamilies: { type: "field", supportedRoles: ["numeric"], aiDescription: "Number of approved families waiting for funds." },
  },
  form: (p) => p.createDefaults({ supportsCrossHighlight: true }),
  featureConfig: { crossFilter: { supportsHighlight: true } },
  comp: FundProgress,
  defaultSize: { width: 24, height: 10 },
  minSize: { width: 8, height: 8 },
};

const MONEY_TRAIL: AgWidgetDefinition<"money-trail", MoneyTrailState> = {
  id: "money-trail",
  label: "Money trail",
  dataMapping: {
    donationTime: { type: "field", supportedRoles: ["temporal"], required: true },
    donationAmount: { type: "field", supportedRoles: ["numeric"], required: true },
    captureId: { type: "field", supportedRoles: ["category"] },
    caseId: { type: "field", supportedRoles: ["category"], required: true },
    paidAt: { type: "field", supportedRoles: ["temporal"], required: true },
    amount: { type: "field", supportedRoles: ["numeric"], required: true },
    need: { type: "field", supportedRoles: ["category"] },
    decidedBy: { type: "field", supportedRoles: ["category"] },
    timeToCash: { type: "field", supportedRoles: ["category"] },
    payoutId: { type: "field", supportedRoles: ["category"] },
  },
  form: (p) => p.createDefaults({ supportsCrossHighlight: true, supportsTriggerCrossFilter: true }),
  featureConfig: { crossFilter: { supportsHighlight: true } },
  comp: MoneyTrail,
  defaultSize: { width: 9, height: 16 },
  minSize: { width: 6, height: 8 },
};

/** The `widgets` property for the ledger's AgStudio: the defaults, our two widgets, and grid cell renderers. */
export const ledgerWidgets = (): AgWidgetsConfig =>
  createWidgets({
    additionalTypes: [FUND_PROGRESS, MONEY_TRAIL],
    overrides: [
      {
        id: "grid",
        options: { createCellRenderer: (field: AgWidgetField) => CELL_RENDERERS[String(field.fieldId)] },
      },
    ],
    // The registry generics only know Studio's own widget types, so the two additions need a cast.
  } as unknown as Parameters<typeof createWidgets>[0]) as unknown as AgWidgetsConfig;
