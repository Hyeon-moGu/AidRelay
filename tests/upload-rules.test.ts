import { describe, expect, it } from "vitest";
import { ACCEPTED_IMAGE_TYPES, fileTypeProblem } from "@/lib/upload-rules";

describe("fileTypeProblem", () => {
  it("accepts the formats the image pipeline decodes, AVIF included", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/tiff", "IMAGE/JPEG"]) {
      expect(fileTypeProblem({ name: "photo", type }), type).toBeNull();
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
