// Money is integer minor units (cents) everywhere inside the app (AGENTS.md §11).
// Convert to/from PayPal's decimal strings only at the edge.

export function assertCents(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new Error(`not a cent amount: ${n}`);
}

/** 2000 → "20.00" (PayPal `amount.value`). */
export function centsToValue(cents: number): string {
  assertCents(cents);
  return (cents / 100).toFixed(2);
}

/** "20.00" | "20" | "20.5" | 20 → 2000. Rejects negatives, more than 2 decimals and non-numbers. */
export function valueToCents(value: string | number): number {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`not a money value: ${JSON.stringify(value)}`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/** 2000 → "$20.00" */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  assertCents(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
