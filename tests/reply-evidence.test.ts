// An applicant asked for "a clear photo" (P-3 / P-9.8) answers with one. The next evaluation must look at it;
// otherwise a case whose first three photos were unusable is asked the same question forever.
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, photo: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});
vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, uploadObject: vi.fn(async (path: string) => path), downloadObject: vi.fn(async () => state.photo as Buffer) };
});
vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});

import { loadCaseImages } from "@/lib/agent/evaluate";
import { createCase, getCase } from "@/lib/db/repos/cases";
import type { CaseDoc } from "@/lib/db/types";
import { submitReply } from "@/lib/intake";
import { downloadObject } from "@/lib/storage/gcs";

let db: FakeFirestore;

beforeEach(async () => {
  db = new FakeFirestore();
  state.db = db;
  state.photo = await sharp({ create: { width: 48, height: 32, channels: 3, background: { r: 20, g: 90, b: 130 } } }).jpeg().toBuffer();
  vi.mocked(downloadObject).mockClear();
});

describe("an applicant's reply photo reaches the next evaluation", () => {
  it("loads the photo the applicant added after three unusable ones", async () => {
    const c = await createCase({
      id: "C-1",
      lang: "en",
      zip: "28501",
      householdSize: 3,
      requestedAmountCents: null,
      narrative: "Water came into the kitchen and the laundry room.",
      photos: ["cases/C-1/photo-1.jpg", "cases/C-1/photo-2.jpg", "cases/C-1/photo-3.jpg"],
      docs: [],
      photoHashes: ["0000000000000001", "0000000000000002", "0000000000000003"],
      contact: { name: "A", email: "a@example.test" },
    });
    await db.collection("cases").doc("C-1").update({ status: "needs_info" });

    await submitReply(c.token, "Here is a clear photo of the kitchen.", [{ name: "clear.jpg", type: "image/jpeg", bytes: state.photo as Buffer }], []);
    const after = (await getCase("C-1")) as CaseDoc;
    expect(after.photos).toHaveLength(4);

    await loadCaseImages(after);
    const loaded = vi.mocked(downloadObject).mock.calls.map(([p]) => p);
    expect(loaded, "the photo the applicant sent in reply").toContain(after.photos[3]);
  });
});
