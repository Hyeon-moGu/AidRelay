// Seed planning without I/O: validates seed/cases.json and seed/accounts.json, expands the bulk spec
// into concrete cases and resolves recipient tokens. scripts/seed.ts does the Firestore and GCS work.
import { z } from "zod";
import { isNearDuplicate } from "@/lib/dedupe/phash";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/db/repos/cases";

const Lang = z.enum(["en", "es"]);
type Lang = z.infer<typeof Lang>;

/** Image paths are relative to seed/ and must stay inside seed/photos/. */
const ImagePath = z
  .string()
  .regex(/^photos\/[\w.-]+(\/[\w.-]+)*\.(jpe?g|png|webp)$/i, "an image under photos/")
  .refine((p) => !p.split("/").includes(".."), "no '..' segments");

const Expected = z.record(z.string(), z.unknown());

const HandCase = z.object({
  id: z.string().regex(/^C-\d{3}$/),
  lang: Lang,
  zip: z.string().regex(/^\d{5}$/),
  householdSize: z.number().int().positive().nullable(),
  requestedAmountCents: z.number().int().nonnegative().nullable(),
  narrative: z.string().min(1),
  photos: z.array(ImagePath).min(1).max(3),
  docs: z.array(ImagePath).max(1),
  contact: z.object({
    name: z.string().min(1),
    email: z.string().min(1),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  _expected: Expected.optional(),
});

const Template = z.object({
  householdSize: z.array(z.number().int().positive()).min(1),
  requestedAmountCents: z.array(z.number().int().nonnegative()).min(1),
  narratives_en: z.array(z.string().min(1)).min(1),
  narratives_es: z.array(z.string().min(1)).min(1),
  _expected: Expected.optional(),
});

const SeedFile = z.object({
  fund: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    currency: z.literal("USD"),
    policyVersion: z.string().min(1),
  }),
  cases: z.array(HandCase).min(1),
  bulk: z.object({
    generate: z.array(
      z.object({
        template: z.string().min(1),
        count: z.number().int().positive(),
        lang: z.partialRecord(Lang, z.number().int().nonnegative()),
        recipientTokens: z.array(z.string()),
      }),
    ),
    zipPool: z.array(z.string().regex(/^\d{5}$/)).min(1),
    streets: z.array(z.string().min(1)).min(1),
    names: z.object({ en: z.array(z.string().min(1)).min(1), es: z.array(z.string().min(1)).min(1) }),
    templates: z.record(z.string(), Template),
  }),
});
export type SeedFile = z.infer<typeof SeedFile>;

export interface PlannedCase {
  id: string;
  source: "hand" | "bulk";
  template?: string;
  lang: Lang;
  zip: string;
  householdSize: number | null;
  requestedAmountCents: number | null;
  narrative: string;
  /** Paths relative to seed/. */
  photos: string[];
  docs: string[];
  contact: { name: string; email: string; phone: string | null; address: string | null };
  /** Test metadata from cases.json; never written to Firestore. */
  expected?: Record<string, unknown>;
}

export interface SeedPlan {
  fund: SeedFile["fund"];
  cases: PlannedCase[];
  /** Hand-crafted cases left out on purpose (`--demo` leaves C-001 for the live scene). */
  skipped: string[];
}

export class SeedPlanError extends Error {
  constructor(public readonly problems: string[]) {
    super(`seed data is not usable:\n  - ${problems.join("\n  - ")}`);
    this.name = "SeedPlanError";
  }
}

/** The case submitted live on camera in the demo video, so `--demo` does not seed it. */
export const DEMO_LIVE_CASE = "C-001";

export function bulkPhotoPath(template: string, n: number): string {
  return `photos/pool/${template}-${String(n).padStart(2, "0")}.jpg`;
}

/**
 * Spreads `lang` counts over `count` slots so the minority language is interleaved rather than
 * bunched at the end: { en: 6, es: 2 } over 8 → en en en es en en en es.
 */
export function spreadLangs(lang: Partial<Record<Lang, number>>, count: number): Lang[] {
  const entries = Object.entries(lang).filter(([, n]) => (n ?? 0) > 0) as Array<[Lang, number]>;
  if (entries.reduce((a, [, n]) => a + n, 0) !== count) throw new Error(`language counts do not add up to ${count}`);
  entries.sort((a, b) => b[1] - a[1]);
  const [majority] = entries[0];
  const slots: Array<Lang | undefined> = new Array(count).fill(undefined);
  for (const [l, n] of entries.slice(1)) {
    for (let k = 0; k < n; k++) {
      let i = Math.min(count - 1, Math.floor(((k + 1) * count) / n) - 1);
      while (slots[i] !== undefined) i = (i + 1) % count;
      slots[i] = l;
    }
  }
  return slots.map((s) => s ?? majority);
}

const TOKEN_RE = /^\{\{(\w+)\}\}$/;

/** Account keys (RECIPIENT_1, BULK_01, …) → sandbox email, validated. Keys starting with "_" are comments. */
function readAccounts(raw: unknown, problems: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== "object") {
    problems.push("seed/accounts.json is not a JSON object");
    return out;
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith("_")) continue;
    const email = (value as { email?: unknown } | null)?.email;
    if (typeof email !== "string" || !email.trim()) continue;
    out.set(key, email.trim());
  }
  return out;
}

function resolveEmail(token: string, accounts: Map<string, string>, owner: string, problems: string[]): string {
  const key = TOKEN_RE.exec(token)?.[1];
  if (!key) {
    problems.push(`${owner}: contact email must be a {{TOKEN}} from seed/accounts.json, got "${token}"`);
    return token;
  }
  const email = accounts.get(key);
  if (!email) {
    problems.push(`${owner}: ${key} has no email in seed/accounts.json`);
    return token;
  }
  if (/x{5}/i.test(email)) {
    problems.push(`${owner}: ${key} still has the template email; put the sandbox account email in seed/accounts.json`);
  } else if (!z.email().safeParse(email).success) {
    problems.push(`${owner}: ${key} email "${email}" is not a valid address`);
  }
  return email;
}

function expectedFlags(c: PlannedCase): string[] {
  const flags = c.expected?.redFlags;
  return Array.isArray(flags) ? flags.filter((f): f is string => typeof f === "string") : [];
}

/**
 * Builds the ordered list of cases to create. Order is creation order, which P-8 uses as first-come
 * within a tier: the hand-crafted cases first, then the bulk cases in spec order.
 */
export function buildSeedPlan(seedRaw: unknown, accountsRaw: unknown, opts: { demo?: boolean } = {}): SeedPlan {
  const parsed = SeedFile.safeParse(seedRaw);
  if (!parsed.success) {
    throw new SeedPlanError(parsed.error.issues.map((i) => `cases.json ${i.path.join(".") || "(root)"}: ${i.message}`));
  }
  const seed = parsed.data;
  const problems: string[] = [];
  const accounts = readAccounts(accountsRaw, problems);

  const cases: PlannedCase[] = [];
  const skipped: string[] = [];
  for (const c of seed.cases) {
    if (opts.demo && c.id === DEMO_LIVE_CASE) {
      skipped.push(c.id);
      continue;
    }
    cases.push({
      id: c.id,
      source: "hand",
      lang: c.lang,
      zip: c.zip,
      householdSize: c.householdSize,
      requestedAmountCents: c.requestedAmountCents,
      narrative: c.narrative,
      photos: c.photos,
      docs: c.docs,
      contact: { ...c.contact, email: resolveEmail(c.contact.email, accounts, c.id, problems) },
      expected: c._expected,
    });
  }

  const lastHandId = Math.max(...seed.cases.map((c) => Number(c.id.slice(2))));
  const { bulk } = seed;
  const nameCounter: Record<Lang, number> = { en: 0, es: 0 };
  let g = 0; // index across all bulk cases: zip, street, house number, phone
  for (const spec of bulk.generate) {
    const t = bulk.templates[spec.template];
    if (!t) {
      problems.push(`bulk: unknown template "${spec.template}"`);
      continue;
    }
    if (spec.recipientTokens.length !== spec.count) {
      problems.push(`bulk ${spec.template}: ${spec.count} cases but ${spec.recipientTokens.length} recipient tokens`);
      continue;
    }
    let langs: Lang[];
    try {
      langs = spreadLangs(spec.lang, spec.count);
    } catch (err) {
      problems.push(`bulk ${spec.template}: ${(err as Error).message}`);
      continue;
    }
    const narrativeCounter: Record<Lang, number> = { en: 0, es: 0 };
    for (let i = 0; i < spec.count; i++) {
      const id = `C-${String(lastHandId + 1 + g).padStart(3, "0")}`;
      const lang = langs[i];
      const narratives = lang === "es" ? t.narratives_es : t.narratives_en;
      const names = bulk.names[lang];
      const street = bulk.streets[g % bulk.streets.length];
      cases.push({
        id,
        source: "bulk",
        template: spec.template,
        lang,
        zip: bulk.zipPool[g % bulk.zipPool.length],
        householdSize: t.householdSize[i % t.householdSize.length],
        requestedAmountCents: t.requestedAmountCents[i % t.requestedAmountCents.length],
        narrative: narratives[narrativeCounter[lang]++ % narratives.length],
        photos: [bulkPhotoPath(spec.template, i + 1)],
        docs: [],
        contact: {
          name: names[nameCounter[lang]++ % names.length],
          email: resolveEmail(spec.recipientTokens[i], accounts, id, problems),
          phone: `+1-828-555-02${String(g + 1).padStart(2, "0")}`,
          address: `${200 + g * 17} ${street}, Cedar Falls`,
        },
        expected: t._expected,
      });
      g++;
    }
  }

  problems.push(...contactCollisions(cases));
  if (problems.length) throw new SeedPlanError(problems);
  return { fund: seed.fund, cases, skipped };
}

/**
 * P-4 compares addresses, emails and phones across cases, so the seed must not create a collision the
 * demo does not intend. A shared address or photo is allowed only where the later case's `_expected`
 * lists the matching red flag (C-009 copies C-003 on purpose); a shared email or phone never is.
 */
function contactCollisions(cases: PlannedCase[]): string[] {
  const problems: string[] = [];
  const seen = { email: new Map<string, string>(), phone: new Map<string, string>(), address: new Map<string, string>(), photo: new Map<string, string>() };
  const check = (kind: keyof typeof seen, key: string | undefined, c: PlannedCase, allowFlag?: string) => {
    if (!key) return;
    const first = seen[kind].get(key);
    if (!first) {
      seen[kind].set(key, c.id);
      return;
    }
    if (allowFlag && expectedFlags(c).includes(allowFlag)) return;
    problems.push(`${c.id} shares its ${kind} with ${first}; P-4 would flag both as one household`);
  };
  for (const c of cases) {
    check("email", normalizeEmail(c.contact.email), c);
    check("phone", normalizePhone(c.contact.phone), c);
    check("address", normalizeAddress(c.contact.address), c, "duplicate_address");
    for (const p of new Set([...c.photos, ...c.docs])) check("photo", p, c, "duplicate_photo_hash");
  }
  return problems;
}

/** Distinct image files that hash as the same photo across cases: the dedupe would flag them (P-4). */
export function nearDuplicateImages(images: Array<{ path: string; hash: string; caseIds: string[] }>): string[] {
  const problems: string[] = [];
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i];
      const b = images[j];
      const sameCaseOnly = a.caseIds.length === 1 && b.caseIds.length === 1 && a.caseIds[0] === b.caseIds[0];
      if (!sameCaseOnly && isNearDuplicate(a.hash, b.hash)) {
        problems.push(`${a.path} and ${b.path} look like the same photo to the duplicate detector; make them more different`);
      }
    }
  }
  return problems;
}

/** Money in flight that a reset would lose track of. */
export function resetBlockers(
  cases: Array<{ id: string; status: string }>,
  payouts: Array<{ caseId: string; outcome: string; status: string }>,
): string[] {
  return [
    ...cases.filter((c) => c.status === "paying").map((c) => `case ${c.id} is paying`),
    ...payouts.filter((p) => p.outcome === "pending").map((p) => `payout for ${p.caseId} is pending at PayPal (${p.status})`),
  ];
}
