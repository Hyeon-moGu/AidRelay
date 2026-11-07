// Difference hash (dHash) for photo reuse detection (policy P-4). 64 bits as 16 hex chars.
// Robust to resizing/recompression; an exactly reused file hashes identically.
import sharp from "sharp";

const W = 9;
const H = 8;

export async function imageHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .rotate()
    .grayscale()
    .resize(W, H, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const left = data[y * W + x];
      const right = data[y * W + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Hashes at or under this distance are treated as the same photo. */
export const DUPLICATE_DISTANCE = 6;

export function isNearDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= DUPLICATE_DISTANCE;
}
