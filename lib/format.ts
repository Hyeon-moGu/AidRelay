// Display formatting shared by server and client components. Money is integer cents everywhere else
// (lib/money.ts); these helpers only turn values into text, always through Intl.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/** 2000 → "$20.00"; null → "" */
export function money(cents: number | null | undefined): string {
  return cents == null ? "" : usd.format(cents / 100);
}

/** 1250000 → "$12,500"; for headline numbers where cents add noise. */
export function moneyWhole(cents: number): string {
  return cents % 100 === 0 ? usdWhole.format(cents / 100) : usd.format(cents / 100);
}

/** Dollars as a number (the ops grid edits dollars) → "$250.00" */
export function dollars(value: number | null | undefined): string {
  return value == null || Number.isNaN(Number(value)) ? "" : usd.format(Number(value));
}

export function num(n: number): string {
  return count.format(n);
}

export function percent(share: number | null | undefined): string {
  return share == null ? "–" : pct.format(share);
}

const utcDateTime = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const localDateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const localTime = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Server-rendered timestamps: fixed to UTC and labelled, so every visitor and the server agree. */
export function utc(iso: string | null | undefined): string {
  return iso ? `${utcDateTime.format(new Date(iso))} UTC` : "";
}

/** Client-only timestamps (inside the grids), in the viewer's time zone. */
export function local(iso: string | null | undefined): string {
  return iso ? localDateTime.format(new Date(iso)) : "";
}

export function clock(iso: string | null | undefined): string {
  return iso ? localTime.format(new Date(iso)) : "";
}

/** "42s ago", "5m ago", "3h ago", then an absolute date after a day. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return local(iso);
}

/** Minutes as "7 min", "2 h 5 min", "3 d". */
export function duration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  // Round once, before splitting into hours: 59.6 is "1 h" and 119.6 is "2 h", never "60 min".
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  if (whole < 1440) {
    const h = Math.floor(whole / 60);
    const m = whole % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(whole / 1440)} d`;
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}
