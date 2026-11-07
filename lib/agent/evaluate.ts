// The multimodal decision: Haiku pre-screens the photos, Sonnet returns a Decision, code applies the
// deterministic parts of the policy (duplicates, declared area, P-6/P-7 amounts) on top.
import { generateObject } from "ai";
import { z } from "zod";
import { isNearDuplicate } from "@/lib/dedupe/phash";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/db/repos/cases";
import type { CaseDoc, DupMatch } from "@/lib/db/types";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { addUsage, officerModel, prescreenModel, type Usage } from "@/lib/agent/models";
import { isAmountOutlier, isInsideDeclaredArea, isTier, maxRecommendedCents } from "@/lib/agent/policy";
import { decisionSystem, decisionUserText, policySystemMessage, PRESCREEN_SYSTEM } from "@/lib/agent/prompts";
import { DecisionSchema, type Decision, type RedFlag } from "@/lib/agent/schema";
import type { AutoApproveLimits } from "@/lib/agent/guardrails";
import { downloadObject, prepareImageForModel } from "@/lib/storage/gcs";

export interface ModelImage {
  data: Buffer;
  mediaType: "image/jpeg";
}

/** Downloads and resizes the case's photos (max 3) and documents (max 1). Missing files are skipped, not fatal. */
export async function loadCaseImages(c: CaseDoc): Promise<ModelImage[]> {
  const paths = [...c.photos.slice(0, 3), ...c.docs.slice(0, 1)];
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

/** Deterministic P-4 check against every other case: photo hash, normalized address, email/phone. */
export function findDuplicates(c: CaseDoc, others: readonly CaseDoc[]): DupMatch[] {
  const addr = normalizeAddress(c.contact.address);
  const email = normalizeEmail(c.contact.email);
  const phone = normalizePhone(c.contact.phone);
  const matches: DupMatch[] = [];
  for (const o of others) {
    if (o.id === c.id) continue;
    const by: DupMatch["by"] = [];
    let photoDistance: number | undefined;
    for (const h of c.photoHashes ?? []) {
      for (const oh of o.photoHashes ?? []) {
        if (isNearDuplicate(h, oh)) {
          by.push("photo");
          photoDistance = 0;
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

const PrescreenSchema = z.object({
  photos: z.array(z.object({ index: z.number().int().min(0), usable: z.boolean(), description: z.string().max(240) })),
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
    return result.object.photos;
  } catch (err) {
    console.warn("[evaluate] prescreen failed, continuing without it:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

export interface DecideArgs {
  c: CaseDoc;
  images: ModelImage[];
  prescreen?: Prescreen;
  dupMatches: DupMatch[];
  policyText: string;
  limits: AutoApproveLimits;
  usage: Usage;
}

/** Sonnet, multimodal, structured output validated against DecisionSchema. Throws on an unparseable answer. */
export async function decideCase(a: DecideArgs): Promise<Decision> {
  const facts = decisionUserText({
    id: a.c.id,
    lang: a.c.lang,
    zip: a.c.zip,
    insideDeclaredArea: isInsideDeclaredArea(a.c.zip),
    householdSize: a.c.householdSize,
    requestedAmountCents: a.c.requestedAmountCents,
    narrative: a.c.narrative,
    photoCount: a.c.photos.length,
    docCount: a.c.docs.length,
    prescreen: a.prescreen,
    duplicates: a.dupMatches.map((d) => ({ caseId: d.caseId, by: d.by })),
  });
  const result = await generateObject({
    model: officerModel(),
    schema: DecisionSchema,
    messages: [
      { role: "system", content: decisionSystem(a.limits) },
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
  return DecisionSchema.parse(result.object);
}

/** Strips anything that looks like an email, phone number or long digit run from public text. */
export function scrubSummary(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted]")
    .slice(0, 140);
}

/**
 * The deterministic layer on top of the model's answer:
 * duplicates (P-4), declared area (P-2), amount outliers, and the P-6/P-7 amount by tier.
 */
export function applyCodeRules(decision: Decision, c: CaseDoc, dupMatches: DupMatch[]): Decision {
  const flags = new Set<RedFlag>(decision.redFlags);
  for (const m of dupMatches) {
    if (m.by.includes("photo")) flags.add("duplicate_photo_hash");
    if (m.by.includes("address")) flags.add("duplicate_address");
    if (m.by.includes("contact")) flags.add("duplicate_contact");
  }
  if (!isInsideDeclaredArea(c.zip)) flags.add("zip_outside_declared_area");
  if (isAmountOutlier(c.requestedAmountCents)) flags.add("amount_outlier");

  let eligibility = decision.eligibility;
  const followUpQuestions = [...decision.followUpQuestions];
  if (flags.has("zip_outside_declared_area") && eligibility === "eligible") {
    eligibility = "needs_info";
    followUpQuestions.push(MESSAGES[normalizeLang(decision.applicantLanguage || c.lang)].proofOfResidence);
  }

  const tier = decision.tier;
  const recommendedAmountCents = eligibility === "eligible" && isTier(tier) ? maxRecommendedCents(tier, c.householdSize) : null;

  return {
    ...decision,
    eligibility,
    recommendedAmountCents,
    redFlags: [...flags],
    followUpQuestions,
    ledgerSummary: scrubSummary(decision.ledgerSummary),
  };
}
