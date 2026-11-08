// Google Cloud Storage for applicant photos/documents. Server-only. Objects are private; the ops console streams them through an authenticated route.
import { Storage, type Bucket } from "@google-cloud/storage";
import sharp from "sharp";
import { getEnv } from "@/lib/env";

let storage: Storage | undefined;

function bucket(): Bucket {
  const env = getEnv();
  storage ??= new Storage({ projectId: env.FIREBASE_PROJECT_ID });
  return storage.bucket(env.GCS_BUCKET);
}

export function casePhotoPath(caseId: string, index: number, ext = "jpg"): string {
  return `cases/${caseId}/photo-${index}.${ext}`;
}

export function caseDocPath(caseId: string, index: number, ext = "jpg"): string {
  return `cases/${caseId}/doc-${index}.${ext}`;
}

export async function uploadObject(objectPath: string, data: Buffer, contentType: string): Promise<string> {
  await bucket().file(objectPath).save(data, { contentType, resumable: false });
  return objectPath;
}

export async function downloadObject(objectPath: string): Promise<Buffer> {
  const [data] = await bucket().file(objectPath).download();
  return data;
}

export async function signedReadUrl(objectPath: string, minutes = 15): Promise<string> {
  const [url] = await bucket()
    .file(objectPath)
    .getSignedUrl({ action: "read", expires: Date.now() + minutes * 60_000 });
  return url;
}

/** What is stored: JPEG, EXIF-rotated, at most 2048 px on the long side (originals are not kept). */
export async function prepareImageForStorage(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

/** ≤ 1024 px on the long side, JPEG, EXIF-rotated: what the model sees. */
export async function prepareImageForModel(input: Buffer): Promise<{ data: Buffer; mediaType: "image/jpeg" }> {
  const data = await sharp(input)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { data, mediaType: "image/jpeg" };
}

/** Every applicant object lives under this prefix (`cases/<caseId>/…`). */
export const CASES_PREFIX = "cases/";

/** Deletes every object under a folder prefix (`pnpm seed --reset`). Returns how many objects were removed. */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!/^[\w-]+\/$/.test(prefix)) throw new Error(`refusing to delete outside a top-level folder prefix: "${prefix}"`);
  const [files] = await bucket().getFiles({ prefix });
  for (let i = 0; i < files.length; i += 20) {
    await Promise.all(files.slice(i, i + 20).map((f) => f.delete({ ignoreNotFound: true })));
  }
  return files.length;
}
