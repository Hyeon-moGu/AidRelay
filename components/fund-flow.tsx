import { cn } from "cn";
import { moneyWhole } from "@/lib/format";

/** The three parts of the raised money, with the color each one uses everywhere (bar, legend, totals). */
export const FUND_PARTS = [
  { key: "paid", label: "Paid", dot: "bg-bar-paid" },
  { key: "reserved", label: "On its way", dot: "bg-bar-reserved" },
  { key: "available", label: "Available", dot: "bg-bar-available" },
] as const;

/** Where the raised money is right now: paid out, on its way to approved families, still available. */
export function FundFlow({
  raised,
  paid,
  reserved,
  available,
  legend = true,
  className,
}: {
  raised: number;
  paid: number;
  reserved: number;
  available: number;
  /** Off where the same three totals are already printed next to the bar. */
  legend?: boolean;
  className?: string;
}) {
  const cents: Record<(typeof FUND_PARTS)[number]["key"], number> = { paid, reserved, available: Math.max(0, available) };
  const total = Math.max(raised, 1);
  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="img"
        aria-label={FUND_PARTS.map((p) => `${p.label} ${moneyWhole(cents[p.key])}`).join(", ")}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-bar-available"
      >
        {raised > 0 &&
          FUND_PARTS.map((p) =>
            cents[p.key] > 0 ? (
              <span key={p.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", p.dot)} style={{ width: `${(cents[p.key] / total) * 100}%` }} />
            ) : null,
          )}
      </div>
      {legend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {FUND_PARTS.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-2 rounded-full", p.dot)} />
              {p.label}
              <span className="font-medium text-foreground tabular-nums">{moneyWhole(cents[p.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
