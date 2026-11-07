import { cn } from "cn";
import { moneyWhole } from "@/lib/format";

/** Where the raised money is right now: paid out, reserved for approved grants, still available. */
export function FundFlow({ raised, paid, reserved, available, className }: { raised: number; paid: number; reserved: number; available: number; className?: string }) {
  const parts = [
    { key: "paid", label: "Paid out", cents: paid, bar: "bg-bar-paid" },
    { key: "reserved", label: "Reserved", cents: reserved, bar: "bg-bar-reserved" },
    { key: "available", label: "Available", cents: Math.max(0, available), bar: "bg-bar-available" },
  ];
  const total = Math.max(raised, 1);
  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.label} ${moneyWhole(p.cents)}`).join(", ")}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-bar-available"
      >
        {raised > 0 &&
          parts.map((p) =>
            p.cents > 0 ? <span key={p.key} className={cn("h-full first:rounded-l-full last:rounded-r-full", p.bar)} style={{ width: `${(p.cents / total) * 100}%` }} /> : null,
          )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-2 rounded-full", p.bar)} />
            {p.label}
            <span className="font-medium text-foreground tabular-nums">{moneyWhole(p.cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
