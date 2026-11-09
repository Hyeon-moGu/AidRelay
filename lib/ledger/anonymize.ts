// Keeps PII out of stored and published records.

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

const REDACTED = "[redacted]";
const STREET_TYPES = "rd|road|st|street|ave|avenue|ln|lane|dr|drive|ct|court|blvd|boulevard|way|pl|place|hwy|highway|cir|circle|ter|terrace|trl|trail";
const STREET_TYPE_RE = new RegExp(`^(?:${STREET_TYPES})\\.?$`, "i");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match on letters and digits in any script (\b only knows ASCII). */
const word = (pattern: string, flags: string) => new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, `${flags}u`);

/**
 * Removes the applicant's own name and street address from text meant for the public ledger. The model is
 * told not to write them; this is the check in code behind that instruction.
 * - Name: the full name in any case, and each part of it as a name is written ("Dana", "DANA", or the
 *   way the applicant typed it), so an ordinary lower-case word that happens to be a name is left alone.
 * - Address: the address as given, the house number with the street words that follow it, and the
 *   street name with a street type ("Mill Creek Rd", "Mill Creek Road"). The street name alone stays:
 *   "Mill Creek overflowed" is a fact about the flood, not an address.
 */
export function scrubIdentity(text: string, contact: { name?: string | null; address?: string | null }): string {
  let out = text;

  const name = contact.name?.trim() ?? "";
  if (name) {
    out = out.replace(word(name.split(/\s+/).map(escapeRe).join("\\s+"), "gi"), REDACTED);
    for (const part of name.split(/\s+/)) {
      const letters = part.replace(/[^\p{L}'-]/gu, "");
      if (letters.length < 3) continue;
      const variants = new Set([letters, letters[0].toUpperCase() + letters.slice(1).toLowerCase(), letters.toUpperCase()]);
      for (const v of variants) out = out.replace(word(escapeRe(v), "g"), REDACTED);
    }
  }

  const address = contact.address?.trim() ?? "";
  if (address) {
    const street = address.split(",")[0].trim();
    for (const literal of new Set([address, street])) {
      if (literal) out = out.replace(word(literal.split(/\s+/).map(escapeRe).join("\\s+"), "gi"), REDACTED);
    }
    const numbered = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(street);
    if (numbered) {
      const [, houseNumber, rest] = numbered;
      const words = rest.split(/\s+/).filter(Boolean);
      const streetType = `(?:${STREET_TYPES})\\.?`;
      // "412 Mill", "412 Mill Creek", "412 Mill Creek Road": the number, the first street word, then as many
      // of the address's own words as follow, with either spelling of the street type.
      const tail = words
        .slice(1)
        .map((w) => `(?:\\s+${STREET_TYPE_RE.test(w) ? streetType : escapeRe(w)})?`)
        .join("");
      out = out.replace(word(`${escapeRe(houseNumber)}\\s+${escapeRe(words[0])}${tail}`, "gi"), REDACTED);
      const streetName = words.filter((w) => !STREET_TYPE_RE.test(w));
      if (streetName.length > 0) out = out.replace(word(`${streetName.map(escapeRe).join("\\s+")}\\s+${streetType}`, "gi"), REDACTED);
    }
  }
  return out;
}

/** Public ledger rows show only the first three digits of a zip code. */
export function zipPrefix(zip: string): string {
  return zip.replace(/\D/g, "").slice(0, 3);
}
