// Applicant intake: validates an application, stores its photos (resized, hashed), creates the case
// and wakes the Case Officer. Also handles an applicant's reply to a needs_info question.
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { imageHash } from "@/lib/dedupe/phash";
import { createCase, getCaseByToken, setCaseStatus, updateCase } from "@/lib/db/repos/cases";
import type { CaseDoc } from "@/lib/db/types";
import { HttpError } from "@/lib/http";
import { caseDocPath, casePhotoPath, prepareImageForStorage, uploadObject } from "@/lib/storage/gcs";

export const MAX_PHOTOS = 3;
export const MAX_DOCS = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "image/tiff"]);

export const ApplicationSchema = z.object({
  lang: z.enum(["en", "es"]).default("en"),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(200).optional().or(z.literal("")),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "5-digit zip code"),
  householdSize: z.coerce.number().int().min(1).max(30).optional().or(z.literal("").transform(() => undefined)),
  requestedAmountDollars: z.coerce.number().min(0).max(100_000).optional().or(z.literal("").transform(() => undefined)),
  narrative: z.string().trim().min(10).max(4000),
});
export type Application = z.infer<typeof ApplicationSchema>;

export interface UploadedFile {
  name: string;
  type: string;
  bytes: Buffer;
}

function checkFiles(files: UploadedFile[], max: number, what: string): void {
  if (files.length > max) throw new HttpError(400, `at most ${max} ${what}`);
  for (const f of files) {
    if (f.bytes.length > MAX_FILE_BYTES) throw new HttpError(400, `${f.name} is larger than 10 MB`);
    if (!IMAGE_TYPES.has(f.type)) throw new HttpError(400, `${f.name}: only image files are accepted (JPEG, PNG, WebP, HEIC)`);
  }
}

async function storeImages(caseId: string, files: UploadedFile[], pathFor: (i: number) => string, startIndex = 1) {
  const paths: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const jpeg = await prepareImageForStorage(files[i].bytes);
    const path = pathFor(startIndex + i);
    await uploadObject(path, jpeg, "image/jpeg");
    paths.push(path);
    hashes.push(await imageHash(jpeg));
  }
  return { paths, hashes };
}

/** Creates the case from a validated application and its files, then wakes the agent. */
export async function submitApplication(app: Application, photos: UploadedFile[], docs: UploadedFile[]): Promise<{ id: string; token: string }> {
  if (photos.length === 0) throw new HttpError(400, "at least one photo is required");
  checkFiles(photos, MAX_PHOTOS, "photos");
  checkFiles(docs, MAX_DOCS, "document");

  // The id is minted before the uploads so the object paths can carry it.
  const id = `C-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const stored = await storeImages(id, photos, (i) => casePhotoPath(id, i));
  const storedDocs = await storeImages(id, docs, (i) => caseDocPath(id, i));

  const c = await createCase({
    id,
    lang: app.lang,
    zip: app.zip,
    householdSize: app.householdSize ?? null,
    requestedAmountCents: app.requestedAmountDollars === undefined ? null : Math.round(app.requestedAmountDollars * 100),
    narrative: app.narrative,
    photos: stored.paths,
    docs: storedDocs.paths,
    photoHashes: [...stored.hashes, ...storedDocs.hashes],
    contact: { name: app.name, email: app.email.toLowerCase(), phone: app.phone || null, address: app.address || null },
  });
  enqueueAgentRun({ trigger: "case.created", caseId: c.id });
  return { id: c.id, token: c.token };
}

export const ReplySchema = z.object({
  text: z.string().trim().max(4000).default(""),
});

/** An applicant answers a needs_info question: the narrative grows, new files are stored, the case goes back to `new`. */
export async function submitReply(token: string, text: string, photos: UploadedFile[], docs: UploadedFile[]): Promise<CaseDoc> {
  const c = await getCaseByToken(token);
  if (!c) throw new HttpError(404, "no application for this link");
  if (c.status !== "needs_info") throw new HttpError(409, "this application is not waiting for information");
  if (!text && photos.length === 0 && docs.length === 0) throw new HttpError(400, "write an answer or add a file");
  checkFiles(photos, MAX_PHOTOS, "photos");
  checkFiles(docs, MAX_DOCS, "document");

  const stored = await storeImages(c.id, photos, (i) => casePhotoPath(c.id, i), c.photos.length + 1);
  const storedDocs = await storeImages(c.id, docs, (i) => caseDocPath(c.id, i), c.docs.length + 1);
  const stamp = new Date().toISOString().slice(0, 10);
  const narrative = text ? `${c.narrative}\n\n[Update ${stamp}] ${text}` : c.narrative;

  await updateCase(
    c.id,
    {
      narrative,
      photos: [...c.photos, ...stored.paths],
      docs: [...c.docs, ...storedDocs.paths],
      photoHashes: [...(c.photoHashes ?? []), ...stored.hashes, ...storedDocs.hashes],
      applicantMessage: undefined,
      dupMatches: undefined,
      notes: [...(c.notes ?? []), { by: "system", text: `applicant replied (${photos.length} photo(s), ${docs.length} document(s), ${text.length} chars)`, at: Timestamp.now() }],
    },
    { actor: "system", action: "case.applicant_replied", reason: "applicant answered the follow-up" },
  );
  const updated = await setCaseStatus(c.id, "new", { actor: "system", action: "case.reopened", reason: "re-evaluate with the applicant's answer", policyClause: "P-5" });
  enqueueAgentRun({ trigger: "case.created", caseId: c.id });
  return updated;
}

/** Reads multipart form data into validated fields and file buffers. */
export async function readMultipart(form: FormData): Promise<{ fields: Record<string, string>; photos: UploadedFile[]; docs: UploadedFile[] }> {
  const fields: Record<string, string> = {};
  const photos: UploadedFile[] = [];
  const docs: UploadedFile[] = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      fields[key] = value;
      continue;
    }
    if (value.size === 0) continue;
    const file: UploadedFile = { name: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) };
    if (key === "photos") photos.push(file);
    else if (key === "docs") docs.push(file);
  }
  return { fields, photos, docs };
}
