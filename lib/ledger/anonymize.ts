// Keeps PII out of stored and published records (AGENTS.md §1.5, docs/policy.md §7).

const PII_KEYS = new Set([
  "payer",
  "payment_source",
  "email_address",
  "email",
  "name",
  "given_name",
  "surname",
  "full_name",
  "address",
  "shipping",
  "phone",
  "phone_number",
  "payer_id",
  "account_id",
  "receiver", // payout item recipient email
]);

/** Deep-copies `value`, dropping any object key that commonly carries personal data. */
export function stripPii<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k)) continue;
      out[k] = walk(v);
    }
    return out;
  }
  return value;
}

/** Redacts anything that looks like an email address or a phone number from free text the agent writes. */
export function scrubPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted]");
}

/** Public ledger rows show only the first three digits of a zip code. */
export function zipPrefix(zip: string): string {
  return zip.replace(/\D/g, "").slice(0, 3);
}
