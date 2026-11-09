import { describe, expect, it } from "vitest";
import { ACCEPTED_IMAGE_TYPES, fileTypeProblem, sniffImageType } from "@/lib/upload-rules";

describe("fileTypeProblem", () => {
  it("accepts JPEG, PNG and WebP, the formats a phone or a screenshot produces", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "IMAGE/JPEG"]) {
      expect(fileTypeProblem({ name: "photo", type }), type).toBeNull();
    }
  });

  it("refuses the formats whose decoders carry published advisories", () => {
    for (const type of ["image/avif", "image/gif", "image/tiff", "image/svg+xml"]) {
      expect(fileTypeProblem({ name: "photo", type }), type).toBe("not_image");
    }
  });

  it("names HEIC by its type or, when the browser gives no type, by its file name", () => {
    expect(fileTypeProblem({ name: "IMG_0042.HEIC", type: "image/heic" })).toBe("heic");
    expect(fileTypeProblem({ name: "IMG_0042.heif", type: "image/heif" })).toBe("heic");
    expect(fileTypeProblem({ name: "burst.heics", type: "image/heic-sequence" })).toBe("heic");
    expect(fileTypeProblem({ name: "IMG_0042.HEIC", type: "" })).toBe("heic");
  });

  it("refuses anything that is not an image", () => {
    expect(fileTypeProblem({ name: "lease.pdf", type: "application/pdf" })).toBe("not_image");
    expect(fileTypeProblem({ name: "notes", type: "" })).toBe("not_image");
  });

  it("does not list HEIC or HEIF as accepted", () => {
    expect(ACCEPTED_IMAGE_TYPES.has("image/heic")).toBe(false);
    expect(ACCEPTED_IMAGE_TYPES.has("image/heif")).toBe(false);
  });
});

describe("sniffImageType", () => {
  const bytes = (...xs: Array<number | string>) =>
    Uint8Array.from(xs.flatMap((x) => (typeof x === "string" ? [...x].map((ch) => ch.charCodeAt(0)) : [x])));

  it("recognizes JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("webp");
  });

  it("names nothing else, whatever type the browser declared", () => {
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(bytes("GIF89a"))).toBeNull();
    expect(sniffImageType(bytes("II*", 0))).toBeNull();
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, "ftypavif"))).toBeNull();
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
  });
});
