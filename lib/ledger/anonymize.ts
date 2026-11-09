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
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted]").replace(/\+?\d[\d\s().-]{5,}\d/g, redactPhoneMatch);
}

const HEALTH_RE =
  /\b(?:asthma\w*|nebuli[sz]ers?|inhalers?|meds|medic(?:al|ations?|ines?)|prescriptions?|insulin|oxygen|dialysis|diabet\w*|pregnan\w*|disab\w*|wheelchairs?|hospital\w*|illness\w*|sick\w*|injur\w*|cpap|chemo\w*|cancer|health)\b/i;

/**
 * The public line says nothing about anyone's health (policy §7). The prompt asks for that; this holds it in
 * code: a part of the line that mentions a condition, a medicine or a medical device is dropped, the rest stays
 * ("family of 5 displaced to motel, child with asthma lost meds" keeps "family of 5 displaced to motel").
 */
export function scrubHealth(text: string): string {
  if (!HEALTH_RE.test(text)) return text;
  return text
    .split(/(?<=[,;.])\s+/)
    .filter((part) => !HEALTH_RE.test(part))
    .join(" ")
    .replace(/[\s,;]+$/, "")
    .trim();
}

const ISO_DATE_RE = /^(?:19|20)\d{2}-\d{2}-\d{2}/;

/**
 * Replacement for a phone-shaped match. A phone number has at least seven digits ("5551234" included); fewer
 * is an amount or a count and stays. A date such as "2026-11-01" (or the "[Update 2026-11-09]" stamp on an
 * applicant's reply) has the same shape and stays too; digits run on after a date are still a number to hide.
 */
export function redactPhoneMatch(match: string): string {
  if ((match.match(/\d/g)?.length ?? 0) < 7) return match;
  const open = match.startsWith("(") ? "(" : "";
  const date = match.slice(open.length).match(ISO_DATE_RE)?.[0];
  if (!date) return "[redacted]";
  const digitsAfterDate = match.slice(open.length + date.length).match(/\d/g)?.length ?? 0;
  return digitsAfterDate >= 7 ? `${open}${date}[redacted]` : match;
}

const REDACTED = "[redacted]";
const STREET_TYPES = "rd|road|st|street|ave|avenue|ln|lane|dr|drive|ct|court|blvd|boulevard|way|pl|place|hwy|highway|cir|circle|ter|terrace|trl|trail";
const DIRECTIONS = "n|s|e|w|ne|nw|se|sw|north|south|east|west";
const STREET_TYPE_RE = new RegExp(`^(?:${STREET_TYPES})\\.?$`, "i");
const DIRECTION_RE = new RegExp(`^(?:${DIRECTIONS})\\.?$`, "i");
/** "Apt B", "Unit 4", "#12": where the street ends and the unit begins. */
const UNIT_RE = /^(?:apt|apartment|unit|ste|suite|lot|bldg|building|fl|floor|rm|room|trailer|spc|space)\.?$|^#/i;
/** What follows a surname when it is used as a name: "Whitfield's", "Whitfield household". */
const NAME_CONTEXT_RE = /^(?:['’]s(?![\p{L}])|\s+(?:family|household|home|house|residence|couple|children|kids)(?![\p{L}]))/iu;
/** The text before a word ends a sentence (or there is none): the word is capitalized by position, not as a name. */
const SENTENCE_START_RE = /(?:^|[.!?;:]\s+|[\n"“(])\s*$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-word match on letters and digits in any script (\b only knows ASCII). */
const word = (pattern: string, flags: string) => new RegExp(`(?<![\\p{L}\\d])${pattern}(?![\\p{L}\\d])`, `${flags}u`);
const phrase = (words: string[]) => words.map(escapeRe).join("\\s+");

/**
 * Removes the applicant's own name and street address from text meant for the public ledger. The model is
 * told not to write them; this is the check in code behind that instruction.
 *
 * Name. The full name goes in any case. A single part goes when it is written as a name: capitalized in
 * the middle of a sentence, or, at the start of one, the given name, or a surname followed by "'s",
 * "family", "household" and the like. A surname that only opens a sentence stays, because surnames are
 * often ordinary words ("Stone foundation cracked", "Flood damage", "Brown water") and blanking the word
 * would both spoil the line and give the name away.
 *
 * Address. The address as given, the house number with the street words after it, and the street name with
 * a street type in either spelling ("Mill Creek Rd", "Mill Creek Road"), with or without a direction ("N
 * Main St"). The unit is not part of the street, and the street name alone stays: "Mill Creek overflowed"
 * is a fact about the flood, not an address.
 */
export function scrubIdentity(text: string, contact: { name?: string | null; address?: string | null }): string {
  return scrubAddress(scrubName(text, contact.name?.trim() ?? ""), contact.address?.trim() ?? "");
}

function scrubName(text: string, name: string): string {
  if (!name) return text;
  const parts = name.split(/\s+/).filter(Boolean);
  let out = text.replace(word(phrase(parts), "gi"), REDACTED);
  parts.forEach((part, index) => {
    const letters = part.replace(/[^\p{L}'-]/gu, "");
    if (letters.length < 2) return; // an initial
    const capitalized = letters[0].toUpperCase() + letters.slice(1).toLowerCase();
    // Two-letter parts ("Li", "Ng") take the careful rule and no all-caps form: "An", "So" and "NC" are words too.
    const short = letters.length < 3;
    const givenName = index === 0 && parts.length > 1 && !short;
    for (const variant of short ? [capitalized] : [capitalized, letters.toUpperCase()]) {
      out = out.replace(word(escapeRe(variant), "g"), (match: string, offset: number, whole: string) => {
        if (givenName || !SENTENCE_START_RE.test(whole.slice(0, offset))) return REDACTED;
        return NAME_CONTEXT_RE.test(whole.slice(offset + match.length)) ? REDACTED : match;
      });
    }
  });
  return out;
}

function scrubAddress(text: string, address: string): string {
  if (!address) return text;
  const segments = address.split(",").map((seg) => seg.trim()).filter(Boolean);
  // The part with the house number: "Apt 4B, 22 Elm Street, Cedar Falls" -> "22 Elm Street".
  const numbered = segments.find((seg) => /^\d+[A-Za-z]?\s+\S/.test(seg));
  let out = text;
  for (const literal of new Set([address, segments[0], numbered].filter((x): x is string => !!x))) {
    out = out.replace(word(phrase(literal.split(/\s+/)), "gi"), REDACTED);
  }

  const line = numbered ?? segments[0] ?? "";
  const houseNumber = /^(\d+[A-Za-z]?)\s+/.exec(line)?.[1];
  let words = line.slice(houseNumber ? houseNumber.length : 0).split(/\s+/).filter(Boolean);
  const unitAt = words.findIndex((w) => UNIT_RE.test(w));
  if (unitAt >= 0) words = words.slice(0, unitAt);
  if (words.length > 1 && DIRECTION_RE.test(words[0])) words = words.slice(1);
  if (words.length > 1 && DIRECTION_RE.test(words[words.length - 1])) words = words.slice(0, -1);
  const streetName = words.filter((w) => !STREET_TYPE_RE.test(w));
  if (streetName.length === 0) return out;

  const direction = `(?:(?:${DIRECTIONS})\\.?\\s+)?`;
  const streetType = `(?:${STREET_TYPES})\\.?`;
  if (houseNumber) {
    // "412 Mill", "412 Mill Creek", "412 N Mill Creek Road": the number, the first street word, then as many of
    // the street's own words as follow, and a street type in either spelling.
    const rest = streetName.slice(1).map((w) => `(?:\\s+${escapeRe(w)})?`).join("");
    out = out.replace(word(`${escapeRe(houseNumber)}\\s+${direction}${escapeRe(streetName[0])}${rest}(?:\\s+${streetType})?`, "gi"), REDACTED);
  }
  return out.replace(word(`${direction}${phrase(streetName)}\\s+${streetType}`, "gi"), REDACTED);
}

/** Public ledger rows show only the first three digits of a zip code. */
export function zipPrefix(zip: string): string {
  return zip.replace(/\D/g, "").slice(0, 3);
}
