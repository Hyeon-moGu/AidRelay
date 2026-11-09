// Upload rules shared by the applicant forms (browser) and the intake API (server).
// No server-only imports here: the forms check a file with the same rule the server applies.

export const MAX_PHOTOS = 3;
export const MAX_DOCS = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Formats the image pipeline can decode (sharp's prebuilt libvips). HEIC and HEIF are left out on purpose:
 * that build reads AVIF but not HEVC-coded images, so a HEIC photo would fail after the upload.
 */
export const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/tiff"]);

export type FileTypeProblem = "heic" | "not_image";

/** Why a file cannot be accepted, judged by its MIME type and its name; null when the type is fine. */
export function fileTypeProblem(file: { name: string; type: string }): FileTypeProblem | null {
  const type = file.type.toLowerCase();
  if (ACCEPTED_IMAGE_TYPES.has(type)) return null;
  // Browsers report a HEIC photo as image/heic, image/heif, or with no type at all.
  if (/^image\/hei[cf](-sequence)?$/.test(type) || /\.hei[cf]$/i.test(file.name)) return "heic";
  return "not_image";
}
