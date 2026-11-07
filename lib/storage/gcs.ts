// Google Cloud Storage for applicant photos/documents. Server-only. Objects are private; the ops console uses signed URLs.
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

/** ≤ 1024 px on the long side, JPEG, EXIF-rotated — what the model sees (AGENTS.md §2, §8). */
export async function prepareImageForModel(input: Buffer): Promise<{ data: Buffer; mediaType: "image/jpeg" }> {
  const data = await sharp(input)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { data, mediaType: "image/jpeg" };
}
