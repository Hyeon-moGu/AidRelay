// Upload rules shared by the applicant forms (browser) and the intake API (server).
// No server-only imports here: the forms check a file with the same rule the server applies.

export const MAX_PHOTOS = 3;
export const MAX_DOCS = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Formats the image pipeline accepts: what a phone camera or a screenshot produces. HEIC and HEIF are left out
 * because sharp's prebuilt libvips cannot decode HEVC-coded images. GIF, TIFF, AVIF and SVG are left out on
 * purpose: their decoders are the parts of the image library with published advisories, and no applicant needs them.
 */
export const ACCEPTED_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FileTypeProblem = "heic" | "not_image";

/** Why a file cannot be accepted, judged by its MIME type and its name; null when the type is fine. */
export function fileTypeProblem(file: { name: string; type: string }): FileTypeProblem | null {
  const type = file.type.toLowerCase();
  if (ACCEPTED_IMAGE_TYPES.has(type)) return null;
  // Browsers report a HEIC photo as image/heic, image/heif, or with no type at all.
  if (/^image\/hei[cf](-sequence)?$/.test(type) || /\.hei[cf]$/i.test(file.name)) return "heic";
  return "not_image";
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/**
 * The format a file really is, by its first bytes. The image library picks its decoder from the bytes, not
 * from the type the browser declared, so the server checks both: an SVG or TIFF sent as "image/png" is
 * refused here, before any decoder sees it.
 */
export function sniffImageType(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return null;
}
