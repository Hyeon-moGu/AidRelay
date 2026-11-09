// Applicant intake against the in-memory Firestore fake: which files are accepted, what a refused file
// costs (nothing stored), and what an applicant's reply leaves on the case. Storage uploads and the agent
// trigger are mocked; the image library (sharp) is real.
import sharp from "sharp";
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});

vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, uploadObject: vi.fn(async (path: string) => path) };
});

vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});

import { enqueueAgentRun } from "@/lib/agent/trigger";
import { createCase, getCase } from "@/lib/db/repos/cases";
import type { CaseDoc } from "@/lib/db/types";
import { HttpError } from "@/lib/http";
import { ApplicationSchema, readForm, submitApplication, submitReply, type UploadedFile } from "@/lib/intake";
import { uploadObject } from "@/lib/storage/gcs";

let db: FakeFirestore;

const application = (lang: "en" | "es" = "en") =>
  ApplicationSchema.parse({
    lang,
    name: "Test Applicant",
    email: "applicant@example.test",
    zip: "28501",
    householdSize: "3",
    narrative: "Water came into the kitchen and the laundry room.",
  });

async function picture(format: "jpeg" | "avif"): Promise<Buffer> {
  const img = sharp({ create: { width: 48, height: 32, channels: 3, background: { r: 20, g: 90, b: 130 } } });
  return format === "jpeg" ? img.jpeg().toBuffer() : img.avif().toBuffer();
}

const file = (name: string, type: string, bytes: Buffer): UploadedFile => ({ name, type, bytes });

async function refusal(run: Promise<unknown>): Promise<HttpError> {
  const err = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  vi.mocked(uploadObject).mockClear();
  vi.mocked(enqueueAgentRun).mockClear();
});

describe("submitApplication files", () => {
  it("stores JPEG and AVIF photos as JPEG and wakes the agent", async () => {
    const { id } = await submitApplication(application(), [file("a.jpg", "image/jpeg", await picture("jpeg")), file("b.avif", "image/avif", await picture("avif"))], []);
    const c = (await getCase(id)) as CaseDoc;
    expect(c.photos).toEqual([`cases/${id}/photo-1.jpg`, `cases/${id}/photo-2.jpg`]);
    expect(c.photoHashes).toHaveLength(2);
    expect(vi.mocked(uploadObject).mock.calls.map((call) => call[2])).toEqual(["image/jpeg", "image/jpeg"]);
    expect(enqueueAgentRun).toHaveBeenCalledWith({ trigger: "case.created", caseId: id });
  });

  it("refuses a HEIC photo with a 400 that names the file, in the applicant's language, before anything is stored", async () => {
    const heic = file("IMG_0042.HEIC", "image/heic", Buffer.from("not decoded"));
    const en = await refusal(submitApplication(application("en"), [heic], []));
    expect(en.status).toBe(400);
    expect(en.message).toContain("IMG_0042.HEIC");
    expect(en.message).toContain("JPEG or PNG");
    const es = await refusal(submitApplication(application("es"), [heic], []));
    expect(es.message).toContain("No pudimos leer IMG_0042.HEIC");
    expect(uploadObject).not.toHaveBeenCalled();
    expect(db.all("cases")).toHaveLength(0);
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("answers 400, not 500, for a file the image library cannot decode, and leaves no upload behind", async () => {
    const good = file("kitchen.jpg", "image/jpeg", await picture("jpeg"));
    const broken = file("broken.jpg", "image/jpeg", Buffer.from("this is not a jpeg"));
    const err = await refusal(submitApplication(application(), [good, broken], []));
    expect(err.status).toBe(400);
    expect(err.message).toContain("broken.jpg");
    expect(uploadObject).not.toHaveBeenCalled();
    expect(db.all("cases")).toHaveLength(0);
  });
});

describe("readForm", () => {
  it("answers 400 to a body that is not a form, and reads one that is", async () => {
    const json = new Request("http://localhost/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await expect(readForm(json)).rejects.toMatchObject({ status: 400 });
    const form = new FormData();
    form.set("zip", "28501");
    expect((await readForm(new Request("http://localhost/api/apply", { method: "POST", body: form }))).get("zip")).toBe("28501");
  });
});

describe("submitReply", () => {
  async function waitingCase(): Promise<CaseDoc> {
    const c = await createCase({
      id: "C-REPLY",
      lang: "en",
      zip: "10001",
      householdSize: 3,
      requestedAmountCents: null,
      narrative: "Water in the basement.",
      photos: ["cases/C-REPLY/photo-1.jpg"],
      docs: [],
      photoHashes: ["00000000000000ff"],
      contact: { name: "A", email: "c-reply@example.test" },
    });
    await db.collection("cases").doc(c.id).update({
      status: "needs_info",
      dupMatches: [],
      applicantMessage: { lang: "en", text: "To finish reviewing your application we need a little more information:\n- Proof of residence", at: Timestamp.now() },
    });
    return (await getCase(c.id)) as CaseDoc;
  }

  it("removes the answered question and the cached duplicate check, and sends the case back for evaluation", async () => {
    const before = await waitingCase();
    expect(before.applicantMessage).toBeDefined();

    const updated = await submitReply(before.token, "Here is my lease.", [file("lease.jpg", "image/jpeg", await picture("jpeg"))], []);
    expect(updated.status).toBe("new");

    const stored = db.read("cases", before.id) as Record<string, unknown>;
    expect(stored).not.toHaveProperty("applicantMessage");
    expect(stored).not.toHaveProperty("dupMatches");
    expect(stored.status).toBe("new");
    expect(stored.narrative).toContain("Here is my lease.");
    expect(stored.photos).toEqual(["cases/C-REPLY/photo-1.jpg", "cases/C-REPLY/photo-2.jpg"]);
    expect(stored.photoHashes).toHaveLength(2);
    expect(enqueueAgentRun).toHaveBeenCalledWith({ trigger: "case.created", caseId: before.id });
  });

  it("keeps the photo hashes in the order of the files: photos first, then documents", async () => {
    const before = await waitingCase();
    await db.collection("cases").doc(before.id).update({ docs: ["cases/C-REPLY/doc-1.jpg"], photoHashes: ["00000000000000ff", "ffffffff00000000"] });
    await submitReply(before.token, "", [file("more.jpg", "image/jpeg", await picture("jpeg"))], []);
    const stored = db.read("cases", before.id) as { photos: string[]; docs: string[]; photoHashes: string[] };
    expect(stored.photos).toEqual(["cases/C-REPLY/photo-1.jpg", "cases/C-REPLY/photo-2.jpg"]);
    expect(stored.photoHashes).toHaveLength(3);
    expect(stored.photoHashes[0]).toBe("00000000000000ff");
    expect(stored.photoHashes[2]).toBe("ffffffff00000000");
  });

  it("records what it cleared in the audit trail without writing a delete marker there", async () => {
    const before = await waitingCase();
    await submitReply(before.token, "Answer.", [], []);
    const replied = db.all("audit_log").find((a) => a.action === "case.applicant_replied") as { after: Record<string, unknown> };
    expect(replied.after.cleared).toEqual(["applicantMessage", "dupMatches"]);
    expect(replied.after).not.toHaveProperty("applicantMessage");
  });

  it("refuses a HEIC attachment and leaves the case waiting, question intact", async () => {
    const before = await waitingCase();
    const err = await refusal(submitReply(before.token, "", [file("IMG_0042.HEIC", "", Buffer.from("x"))], []));
    expect(err.status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
    const stored = db.read("cases", before.id) as Record<string, unknown>;
    expect(stored.status).toBe("needs_info");
    expect(stored).toHaveProperty("applicantMessage");
  });
});
