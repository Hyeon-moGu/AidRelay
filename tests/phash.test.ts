import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hammingDistance, imageHash, isNearDuplicate } from "@/lib/dedupe/phash";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/db/repos/cases";

const W = 64;
const H = 48;

/** Horizontal gradient; `reverse` flips it; `noise` perturbs pixels slightly. */
async function gradientJpeg(opts: { reverse?: boolean; noise?: number } = {}): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = opts.reverse ? (W - 1 - x) / (W - 1) : x / (W - 1);
      const v = Math.max(0, Math.min(255, Math.round(t * 255 + (opts.noise ? (rand() - 0.5) * opts.noise : 0))));
      const i = (y * W + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

describe("imageHash (dHash)", () => {
  it("is a 16-hex-char hash, stable for the same bytes", async () => {
    const img = await gradientJpeg();
    const a = await imageHash(img);
    const b = await imageHash(img);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it("survives resizing and mild noise (the reused C-003 photo on C-009)", async () => {
    const original = await imageHash(await gradientJpeg());
    const resized = await imageHash(await sharp(await gradientJpeg()).resize(300).jpeg({ quality: 60 }).toBuffer());
    const noisy = await imageHash(await gradientJpeg({ noise: 12 }));
    expect(isNearDuplicate(original, resized)).toBe(true);
    expect(isNearDuplicate(original, noisy)).toBe(true);
  });

  it("separates a different picture", async () => {
    const a = await imageHash(await gradientJpeg());
    const b = await imageHash(await gradientJpeg({ reverse: true }));
    expect(hammingDistance(a, b)).toBe(64);
    expect(isNearDuplicate(a, b)).toBe(false);
  });
});

describe("contact normalization for P-4", () => {
  it("address: C-003 and C-009 spell the same street differently", () => {
    expect(normalizeAddress("1180 Low Gap Rd, Cedar Falls")).toBe(normalizeAddress("1180 Low Gap Road, Cedar Falls"));
    expect(normalizeAddress("412 Mill Creek Rd, Cedar Falls")).not.toBe(normalizeAddress("1180 Low Gap Rd, Cedar Falls"));
    expect(normalizeAddress("")).toBeUndefined();
  });
  it("email and phone", () => {
    expect(normalizeEmail("  SB-R1@Personal.Example.com ")).toBe("sb-r1@personal.example.com");
    expect(normalizePhone("+1-828-555-0101")).toBe("8285550101");
    expect(normalizePhone(null)).toBeUndefined();
  });
});
