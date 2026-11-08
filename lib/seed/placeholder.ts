// Labeled gray stand-ins for seed photos (`pnpm seed --placeholders`), so the pipeline runs before the
// generated photos exist. The block pattern is derived from the label: different files hash apart
// under dHash (no false P-4 duplicates), and a file reused on purpose (C-009 → C-003) hashes the same.
import { createHash } from "node:crypto";
import sharp from "sharp";

const COLS = 9;
const ROWS = 8;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!);
}

export async function placeholderImage(label: string, width = 1024, height = 768): Promise<Buffer> {
  const digest = createHash("sha256").update(label).digest();
  const cells = Buffer.alloc(COLS * ROWS * 3);
  for (let i = 0; i < COLS * ROWS; i++) {
    const v = 70 + Math.round((digest[i % digest.length] ^ (i * 37)) % 121); // 70..190: stays gray
    cells.fill(v, i * 3, i * 3 + 3);
  }
  const blocks = await sharp(cells, { raw: { width: COLS, height: ROWS, channels: 3 } })
    .resize(width, height, { kernel: "nearest" })
    .png()
    .toBuffer();
  const bandH = 96;
  const label1 = escapeXml("PLACEHOLDER, NOT A REAL PHOTO");
  const label2 = escapeXml(label);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandH}">` +
      `<rect width="100%" height="100%" fill="#202020" fill-opacity="0.8"/>` +
      `<text x="50%" y="40" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff" text-anchor="middle">${label1}</text>` +
      `<text x="50%" y="76" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#d0d0d0" text-anchor="middle">${label2}</text>` +
      `</svg>`,
  );
  return sharp(blocks)
    .composite([{ input: svg, top: height - bandH - 24, left: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer();
}
