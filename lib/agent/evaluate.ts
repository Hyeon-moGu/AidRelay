// The multimodal decision: Haiku pre-screens the photos, Sonnet returns a Decision, code applies the
// deterministic parts of the policy (duplicates, declared area, evidence, P-6/P-7 amounts) on top.
import { generateObject } from "ai";
import { z } from "zod";
import { hammingDistance, isNearDuplicate } from "@/lib/dedupe/phash";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/db/repos/cases";
import type { CaseDoc, DupMatch } from "@/lib/db/types";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { scrubHealth, scrubIdentity, scrubPii } from "@/lib/ledger/anonymize";
import { addUsage, officerModel, prescreenModel, type Usage } from "@/lib/agent/models";
import { isAmountOutlier, isInsideDeclaredArea, isTier, maxRecommendedCents, POLICY } from "@/lib/agent/policy";
import { decisionSystem, decisionUserText, policySystemMessage, PRESCREEN_SYSTEM } from "@/lib/agent/prompts";
import { DecisionSchema, POLICY_CLAUSE_RE, type Decision, type RedFlag } from "@/lib/agent/schema";
import type { AutoApproveLimits } from "@/lib/agent/guardrails";
import { downloadObject, prepareImageForModel } from "@/lib/storage/gcs";

export interface ModelImage {
  data: Buffer;
  mediaType: "image/jpeg";
}

/** What one evaluation looks at: the newest photos and the newest document. */
export const MODEL_PHOTOS = 3;
export const MODEL_DOCS = 1;

/**
 * Downloads and resizes the case's newest photos (max 3) and newest document (max 1). An applicant's reply
 * adds files after the first ones, and those are the answer to the question asked, so they come first in
 * line. Missing files are skipped, not fatal.
 */
export async function loadCaseImages(c: CaseDoc): Promise<ModelImage[]> {
  const paths = [...c.photos.slice(-MODEL_PHOTOS), ...c.docs.slice(-MODEL_DOCS)];
  const images: ModelImage[] = [];
  for (const p of paths) {
    try {
      images.push(await prepareImageForModel(await downloadObject(p)));
    } catch (err) {
      console.warn(`[evaluate] could not load ${p} for ${c.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return images;
}

/**
 * Deterministic P-4 check: photo hash, normalized address, email/phone, against cases that were
 * created BEFORE this one, so the earlier application is never flagged because of a later copy.
 */
export function findDuplicates(c: CaseDoc, others: readonly CaseDoc[]): DupMatch[] {
  const addr = normalizeAddress(c.contact.address);
  const email = normalizeEmail(c.contact.email);
  const phone = normalizePhone(c.contact.phone);
  const createdMs = c.timestamps.created.toMillis();
  const matches: DupMatch[] = [];
  for (const o of others) {
    if (o.id === c.id) continue;
    const oMs = o.timestamps.created.toMillis();
    if (oMs > createdMs || (oMs === createdMs && o.id > c.id)) continue;
    const by: DupMatch["by"] = [];
    let photoDistance: number | undefined;
    for (const h of c.photoHashes ?? []) {
      for (const oh of o.photoHashes ?? []) {
        if (isNearDuplicate(h, oh)) {
          by.push("photo");
          photoDistance = hammingDistance(h, oh);
          break;
        }
      }
      if (by.includes("photo")) break;
    }
    if (addr && addr === normalizeAddress(o.contact.address)) by.push("address");
    if ((email && email === normalizeEmail(o.contact.email)) || (phone && phone === normalizePhone(o.contact.phone))) by.push("contact");
    if (by.length) matches.push({ caseId: o.id, by, photoDistance });
  }
  return matches;
}

type CaseFiles = Pick<CaseDoc, "photos" | "docs" | "photoHashes">;

/**
 * The two files behind a photo match (P-4): this case's and the earlier case's, so a volunteer can look at
 * them side by side. `photoHashes` follows [...photos, ...docs]; when a case's lists do not line up, no
 * pair is returned rather than a wrong one.
 */
export function matchingPhotoPair(c: CaseFiles, other: CaseFiles): { thisPath: string; otherPath: string } | null {
  const mine = [...c.photos, ...c.docs];
  const theirs = [...other.photos, ...other.docs];
  const myHashes = c.photoHashes ?? [];
  const theirHashes = other.photoHashes ?? [];
  if (myHashes.length !== mine.length || theirHashes.length !== theirs.length) return null;
  for (let i = 0; i < myHashes.length; i++) {
    for (let j = 0; j < theirHashes.length; j++) {
      if (isNearDuplicate(myHashes[i], theirHashes[j])) return { thisPath: mine[i], otherPath: theirs[j] };
    }
  }
  return null;
}

/**
 * Prompt-injection heuristics for the applicant narrative (English and Spanish). Real applicants describe
 * damage; they do not address "the system", quote policy clause ids, or set their own confidence.
 */
const INJECTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(ignore|disregard|override|forget)\b[^.]{0,40}\b(instruction|rule|polic|guideline|prompt|limit)/i, "ignore-instructions"],
  [/\b(ignora|ignore|olvida|omite)\b[^.]{0,40}\b(instrucci|regla|polític|indicaci)/i, "ignore-instructions"],
  [/\bsystem prompt\b|\bprompt del sistema\b/i, "system-prompt"],
  [/\b(you are|act as|pretend to be|as an?)\b[^.]{0,30}\b(ai|assistant|model|language model|case officer|agent)\b/i, "role-play"],
  [/\b(eres|actúa como|actua como|finge ser)\b[^.]{0,30}\b(asistente|modelo|ia|agente|oficial)\b/i, "role-play"],
  [/\bP-\d+(\.\d+)?\b/, "policy-clause-id"],
  [/\b(auto[- ]?approve|auto[- ]?approval|confidence\s*[:=]?\s*0?\.\d+|eligib(?:le|ility)\s*[:=]|confianza\s*[:=]?\s*0?[.,]\d+)/i, "policy-vocabulary"],
  [/\b(mark|set|classify|rate)\b[^.]{0,30}\b(eligible|approved|tier\s*[1-4])\b/i, "dictates-outcome"],
  [/\b(marca|marque|clasifica|aprueba)\b[^.]{0,30}\b(elegible|aprobad|nivel\s*[1-4])\b/i, "dictates-outcome"],
];

export function detectInstructionInjection(text: string): string[] {
  const hits = new Set<string>();
  for (const [re, label] of INJECTION_PATTERNS) if (re.test(text)) hits.add(label);
  return [...hits];
}

const PrescreenSchema = z.object({
  photos: z.array(z.object({ index: z.number().int(), usable: z.boolean(), description: z.string() })),
});
export type Prescreen = z.infer<typeof PrescreenSchema>["photos"];

/** Haiku: usable / not usable + one-line description per image. Optional: any failure returns undefined. */
export async function prescreenPhotos(images: ModelImage[], usage: Usage): Promise<Prescreen | undefined> {
  if (images.length === 0) return undefined;
  try {
    const result = await generateObject({
      model: prescreenModel(),
      schema: PrescreenSchema,
      system: PRESCREEN_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${images.length} image(s) follow. Index them from 0 in order.` },
            ...images.map((img) => ({ type: "image" as const, image: img.data, mediaType: img.mediaType })),
          ],
        },
      ],
    });
    addUsage(usage, result.usage);
    return result.object.photos.map((p) => ({ ...p, description: p.description.slice(0, 240) }));
  } catch (err) {
    console.warn("[evaluate] prescreen failed, continuing without it:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

/** Usable evidence count: the pre-screen's verdict when available, otherwise every image that loaded. */
export function countUsableEvidence(images: ModelImage[], prescreen: Prescreen | undefined): number {
  if (!prescreen) return images.length;
  return prescreen.filter((p) => p.usable).length;
}

export interface DecideArgs {
  c: CaseDoc;
  images: ModelImage[];
  prescreen?: Prescreen;
  dupMatches: DupMatch[];
  policyText: string;
  limits: AutoApproveLimits;
  usage: Usage;
  /** P-9.9: the second, independent evaluation (different framing, never sees the first answer). */
  secondOpinion?: boolean;
}

/**
 * Sonnet, multimodal, structured output validated against DecisionSchema, then normalized.
 * Throws NoObjectGeneratedError (unparseable answer) or APICallError (transport), callers tell them apart.
 */
export async function decideCase(a: DecideArgs): Promise<Decision> {
  const facts = decisionUserText({
    id: a.c.id,
    lang: a.c.lang,
    zip: a.c.zip,
    insideDeclaredArea: isInsideDeclaredArea(a.c.zip),
    householdSize: a.c.householdSize,
    requestedAmountCents: a.c.requestedAmountCents,
    narrative: a.c.narrative,
    photoCount: Math.min(a.c.photos.length, MODEL_PHOTOS),
    docCount: Math.min(a.c.docs.length, MODEL_DOCS),
    applicantReplies: a.c.applicantReplies ?? 0,
    prescreen: a.prescreen,
    duplicates: a.dupMatches.map((d) => ({ caseId: d.caseId, by: d.by })),
  });
  const result = await generateObject({
    model: officerModel(),
    schema: DecisionSchema,
    allowSystemInMessages: true,
    messages: [
      { role: "system", content: decisionSystem(a.limits, { secondOpinion: a.secondOpinion }) },
      policySystemMessage(a.policyText),
      {
        role: "user",
        content: [
          { type: "text", text: facts },
          ...a.images.map((img) => ({ type: "image" as const, image: img.data, mediaType: img.mediaType })),
        ],
      },
    ],
  });
  addUsage(a.usage, result.usage);
  return normalizeDecision(DecisionSchema.parse(result.object));
}

/**
 * Public-ledger text: no emails, no phone numbers, at most 140 characters. Cut last: applyCodeRules removes
 * the applicant's name and address first, so a cut never leaves part of a name behind.
 */
export function scrubSummary(text: string): string {
  return scrubPii(text).slice(0, 140);
}

/** Pulls a clause id like P-9 or P-9.3 out of free text; keeps the raw text when there is none. */
export function normalizeClause(clause: string): string {
  const trimmed = clause.trim().toUpperCase().replace(/\s+/g, "");
  if (POLICY_CLAUSE_RE.test(trimmed)) return trimmed;
  const found = /P-?(\d+)(?:\.(\d+))?/i.exec(clause);
  return found ? `P-${found[1]}${found[2] ? `.${found[2]}` : ""}` : clause.trim().slice(0, 20);
}

/** Applies the format rules the schema deliberately leaves out (see schema.ts). Pure. */
export function normalizeDecision(d: Decision): Decision {
  const tier = isTier(d.tier) ? d.tier : null;
  const confidence = Number.isFinite(d.confidence) ? Math.min(1, Math.max(0, d.confidence)) : 0;
  return {
    ...d,
    tier,
    confidence,
    reasons: d.reasons
      .map((r) => ({ clause: normalizeClause(r.clause), evidence: scrubPii(r.evidence.trim()).slice(0, 300) }))
      .filter((r) => r.evidence.length > 0),
    redFlags: [...new Set(d.redFlags)],
    followUpQuestions: d.followUpQuestions.map((q) => scrubPii(q.trim())).filter((q) => q.length > 0),
    applicantLanguage: normalizeLang(d.applicantLanguage),
    // Cut to 140 characters only in applyCodeRules, after the name and address are gone.
    ledgerSummary: scrubPii(d.ledgerSummary.trim()).slice(0, 1000),
  };
}

export interface EvidenceInfo {
  /** Usable photos/documents (P-3, P-9.8). */
  usable: number;
  /** The pre-screen's one-line descriptions, scanned for instructions written inside the images. */
  descriptions?: readonly string[];
}

/**
 * The deterministic layer on top of the model's answer:
 * duplicates (P-4), declared area (P-2), evidence on file (P-3), prompt injection,
 * amount outliers, and the P-6/P-7 amount by tier.
 */
export function applyCodeRules(decision: Decision, c: CaseDoc, dupMatches: DupMatch[], evidence?: EvidenceInfo): Decision {
  const flags = new Set<RedFlag>(decision.redFlags);
  for (const m of dupMatches) {
    if (m.by.includes("photo")) flags.add("duplicate_photo_hash");
    if (m.by.includes("address")) flags.add("duplicate_address");
    if (m.by.includes("contact")) flags.add("duplicate_contact");
  }
  // P-2 is decided in code from the zip, in both directions: the model's own zip flag never stands.
  if (isInsideDeclaredArea(c.zip)) flags.delete("zip_outside_declared_area");
  else flags.add("zip_outside_declared_area");
  if (isAmountOutlier(c.requestedAmountCents)) flags.add("amount_outlier");
  if (detectInstructionInjection(c.narrative).length > 0) flags.add("instruction_in_narrative");
  // Writing inside a photo reaches the decision through the pre-screen's descriptions: scanned the same way.
  if ((evidence?.descriptions ?? []).some((d) => detectInstructionInjection(d).length > 0)) flags.add("instruction_in_narrative");

  const lang = normalizeLang(decision.applicantLanguage || c.lang);
  let eligibility = decision.eligibility;
  const followUpQuestions = [...decision.followUpQuestions];
  // P-2: an address outside the declared area gets the proof-of-residence question once, together with anything
  // else the applicant is asked. Once they have answered, a volunteer decides (decideStatus) and it is not asked again.
  // An "ineligible" answer outside the area is asked too: decideStatus sends it to needs_info, and a follow-up
  // message without the question would leave the applicant nothing to answer.
  if (flags.has("zip_outside_declared_area") && !(c.applicantReplies ?? 0)) {
    if (eligibility === "eligible") eligibility = "needs_info";
    if (!followUpQuestions.includes(MESSAGES[lang].proofOfResidence)) followUpQuestions.push(MESSAGES[lang].proofOfResidence);
  }
  if (evidence && evidence.usable < POLICY.autoApproveMinEvidence && eligibility === "eligible") {
    eligibility = "needs_info";
    followUpQuestions.push(MESSAGES[lang].clearPhoto);
  }

  const tier = decision.tier;
  const recommendedAmountCents = eligibility === "eligible" && isTier(tier) ? maxRecommendedCents(tier, c.householdSize) : null;

  // The model's reasons and questions travel further than the case: into the orchestrator's view of it, and
  // from there into run summaries a visitor of the open console reads. They lose the applicant's own name and
  // street address too.
  const withoutIdentity = (text: string) => scrubIdentity(text, c.contact);
  return {
    ...decision,
    eligibility,
    recommendedAmountCents,
    redFlags: [...flags],
    reasons: decision.reasons.map((r) => ({ ...r, evidence: withoutIdentity(r.evidence) })),
    followUpQuestions: followUpQuestions.map(withoutIdentity),
    // The public line never carries the applicant's own name or street address, nor anything about anyone's
    // health (policy §7).
    ledgerSummary: scrubSummary(scrubHealth(scrubIdentity(decision.ledgerSummary, c.contact))),
  };
}
