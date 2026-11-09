// The open demo console: who may look, who may act, and what a visitor's copy of a case leaves out.
// The route handlers run against the in-memory Firestore fake, with the cookie jar and OPS_PUBLIC_VIEW under
// the test's control. Nothing here reaches a real service.
import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown, cookie: undefined as string | undefined, publicView: true }));

vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), OPS_PUBLIC_VIEW: state.publicView }) };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (state.cookie ? { name, value: state.cookie } : undefined) }),
}));

vi.mock("@/lib/agent/trigger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/trigger")>();
  return { ...actual, enqueueAgentRun: vi.fn() };
});

vi.mock("@/lib/storage/gcs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/gcs")>();
  return { ...actual, downloadObject: vi.fn(async () => Buffer.from("jpeg bytes")) };
});

import { POST as postAsk } from "@/app/api/ops/ask/route";
import { GET as getCaseDetail } from "@/app/api/ops/cases/[id]/route";
import { GET as getCases } from "@/app/api/ops/cases/route";
import { POST as postDecide } from "@/app/api/ops/decide/route";
import { POST as postPayoutRetry } from "@/app/api/ops/payout-retry/route";
import { GET as getPhoto } from "@/app/api/ops/photo/route";
import { GET as getRuns } from "@/app/api/ops/runs/route";
import { SIGN_IN_TO_ASK, claudeAdapter } from "@/app/ops/audit/claude-adapter";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { createCase } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import { makeSessionValue, opsAccess } from "@/lib/ops/auth";
import { downloadObject } from "@/lib/storage/gcs";
import { clearSharedForViewers, scrubContactText, sharedForViewers, viewerDetail, viewerRow, viewerRun } from "@/lib/ops/public-view";
import type { CaseDetail, OpsRow, OpsRun } from "@/lib/ops/rows";

let db: FakeFirestore;

const NAME = "Marisol Whitfield";
const EMAIL = "marisol.whitfield@example.test";
const PHONE = "(252) 555-0142";
const ADDRESS = "418 Juniper Lane";

const signIn = () => {
  state.cookie = makeSessionValue();
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = async (res: Response) => (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string };
const post = (url: string, payload: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

async function seed(): Promise<{ token: string }> {
  await getFund();
  const c = await createCase({
    id: "C-OPEN",
    lang: "en",
    zip: "28501",
    householdSize: 3,
    requestedAmountCents: 35_000,
    narrative: `I am ${NAME}. Water reached the kitchen at ${ADDRESS}. Call me on ${PHONE} or write to ${EMAIL}.\n\n[Update 2026-11-09] Here is my lease.`,
    photos: ["cases/C-OPEN/photo-1.jpg"],
    docs: [],
    contact: { name: NAME, email: EMAIL, phone: PHONE, address: ADDRESS },
  });
  await db.collection("cases").doc("C-OPEN").update({ status: "needs_review", tier: 3, approvedAmountCents: 35_000 });
  await db.collection("payouts").doc("C-OPEN").set({
    caseId: "C-OPEN",
    senderBatchId: `C-OPEN-${c.token.slice(0, 8)}`,
    attemptId: "attempt-1",
    amountCents: 35_000,
    currency: "USD",
    recipientEmail: EMAIL,
    status: "create_failed",
    outcome: "pending",
    error: `receiver ${EMAIL} is not valid`,
    events: [],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return { token: c.token };
}

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
  state.cookie = undefined;
  state.publicView = true;
  clearSharedForViewers();
  vi.mocked(enqueueAgentRun).mockClear();
});

describe("who may look and who may act", () => {
  it("a visitor is a viewer while the demo console is open, and nobody once it is closed; a session is an operator either way", async () => {
    expect(await opsAccess()).toBe("viewer");
    state.publicView = false;
    expect(await opsAccess()).toBe("none");
    signIn();
    expect(await opsAccess()).toBe("operator");
    state.publicView = true;
    expect(await opsAccess()).toBe("operator");
  });

  it("the read routes answer a visitor only while the console is open", async () => {
    await seed();
    const photo = () => getPhoto(new Request("http://localhost/api/ops/photo?path=cases/C-OPEN/photo-1.jpg"));
    const runs = () => getRuns(new Request("http://localhost/api/ops/runs?limit=15"));
    expect((await getCases()).status).toBe(200);
    expect((await getCaseDetail(new Request("http://localhost/"), params("C-OPEN"))).status).toBe(200);
    expect((await photo()).status).toBe(200);
    expect((await runs()).status).toBe(200);

    state.publicView = false;
    expect((await getCases()).status).toBe(401);
    expect((await getCaseDetail(new Request("http://localhost/"), params("C-OPEN"))).status).toBe(401);
    expect((await photo()).status).toBe(401);
    expect((await runs()).status).toBe(401);
  });

  it("every action needs the operator session, open console or not, and a refused action changes nothing", async () => {
    await seed();
    for (const open of [true, false]) {
      state.publicView = open;
      const decide = await postDecide(post("http://localhost/api/ops/decide", { action: "approve", caseIds: ["C-OPEN"] }));
      expect(decide.status).toBe(401);
      const retry = await postPayoutRetry(post("http://localhost/api/ops/payout-retry", { caseId: "C-OPEN" }));
      expect(retry.status).toBe(401);
      // Asking the ledger is a paid model call: the route refuses before it reads the question.
      const ask = await postAsk(post("http://localhost/api/ops/ask", { input: [{ type: "message" }], responseFormat: { type: "text" } }));
      expect(ask.status).toBe(401);
    }
    const stored = db.read("cases", "C-OPEN") as Record<string, unknown>;
    expect(stored.status).toBe("needs_review");
    expect(stored).not.toHaveProperty("humanDecision");
    expect((db.read("payouts", "C-OPEN") as Record<string, unknown>).status).toBe("create_failed");
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("a visitor is refused an applicant's document (proof of address), which a signed-in volunteer can open", async () => {
    const doc = () => getPhoto(new Request(`http://localhost/api/ops/photo?path=${encodeURIComponent("cases/C-OPEN/doc-1.jpg")}`));
    expect((await doc()).status).toBe(403);
    state.cookie = makeSessionValue();
    expect((await doc()).status).toBe(200);
    state.cookie = undefined;
  });

  it("answers 404, not 500, for a well-formed path to a file that does not exist", async () => {
    vi.mocked(downloadObject).mockRejectedValueOnce(Object.assign(new Error("No such object"), { code: 404 }));
    const res = await getPhoto(new Request("http://localhost/api/ops/photo?path=cases%2FC-OPEN%2Fphoto-9.jpg"));
    expect(res.status).toBe(404);
  });

  it("a visitor cannot use the photo route to read anything but a case photo", async () => {
    for (const path of ["cases/C-OPEN/../../secrets.json", "seed/accounts.json", "cases/C-OPEN/photo-1.png", ""]) {
      const res = await getPhoto(new Request(`http://localhost/api/ops/photo?path=${encodeURIComponent(path)}`));
      expect(res.status, path).toBe(400);
    }
  });
});

describe("asking the ledger as a visitor", () => {
  it("answers in the browser with the reason and sends nothing to the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const turn = claudeAdapter("/api/ops/ask", { canAsk: false }).executeTurn({ input: [] } as never);
    const response = await turn.complete;
    expect(response.status).toBe("completed");
    expect(response.output).toMatchObject([{ type: "message", role: "assistant", content: [{ type: "text", text: SIGN_IN_TO_ASK }] }]);
    const events: Array<{ type: string }> = [];
    for await (const event of turn.stream) events.push(event);
    expect(events.map((e) => e.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("a signed-in operator's question goes to the model endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "sign in first" }), { status: 401 }));
    const response = await claudeAdapter("/api/ops/ask").executeTurn({ input: [] } as never).complete;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/ops/ask");
    expect(response.error?.message).toContain("staff session has ended");
    fetchSpy.mockRestore();
  });
});

describe("what a visitor receives", () => {
  it("the queue has no names or emails for a visitor, and has them for an operator", async () => {
    await seed();
    const visitor = JSON.stringify(await body(await getCases()));
    expect(visitor).toContain("C-OPEN");
    expect(visitor).not.toContain(EMAIL);
    expect(visitor).not.toContain("Marisol");

    signIn();
    const operator = JSON.stringify(await body(await getCases()));
    expect(operator).toContain(EMAIL);
    expect(operator).toContain(NAME);
  });

  it("the case panel has no contact details, no status link and no payout recipient for a visitor", async () => {
    const { token } = await seed();
    const res = await getCaseDetail(new Request("http://localhost/"), params("C-OPEN"));
    const text = JSON.stringify(await body(res));
    expect(text).toContain("Water reached the kitchen");
    expect(text).toContain("[Update 2026-11-09]");
    for (const secret of [token, token.slice(0, 8), EMAIL, "Marisol", "Whitfield", "555-0142", "Juniper"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toContain("recipientEmail");
    expect(text).not.toContain("senderBatchId");
    expect(text).not.toContain("photoHashes");

    signIn();
    const operator = JSON.stringify(await body(await getCaseDetail(new Request("http://localhost/"), params("C-OPEN"))));
    expect(operator).toContain(EMAIL);
    expect(operator).toContain(ADDRESS);
  });

  it("a case that does not exist, or an id that is not one, is a 404 for a visitor", async () => {
    await seed();
    expect((await getCaseDetail(new Request("http://localhost/"), params("C-NOPE"))).status).toBe(404);
    expect((await getCaseDetail(new Request("http://localhost/"), params("x".repeat(60)))).status).toBe(404);
  });
});

describe("viewerDetail", () => {
  const detail = (): CaseDetail =>
    ({
      dupPhotos: [],
      case: {
        id: "C-1",
        token: "0123456789abcdef0123456789abcdef",
        photoHashes: ["00ff"],
        status: "needs_info",
        lang: "en",
        zip: "28501",
        householdSize: 3,
        requestedAmountCents: null,
        narrative: `${NAME} here, ${PHONE}.`,
        contact: { name: NAME, email: EMAIL, phone: PHONE, address: ADDRESS },
        humanDecision: { approved: false, by: "human:ops", note: `asked ${EMAIL} for a lease`, at: "2026-11-09T01:00:00.000Z" },
        applicantMessage: { lang: "en", text: "Please send proof of residence.", at: "2026-11-09T01:00:00.000Z" },
        notes: [{ by: "human:ops", text: `called ${PHONE}`, at: "2026-11-09T01:00:00.000Z" }],
        timestamps: { created: "2026-11-09T00:00:00.000Z" },
        photoUrls: ["/api/ops/photo?path=cases%2FC-1%2Fphoto-1.jpg"],
        docUrls: [],
      },
      payout: { status: "create_failed", outcome: "pending", amountCents: 25_000, recipientEmail: EMAIL, senderBatchId: "C-1-01234567", error: `bad receiver ${EMAIL}`, events: [] },
      audit: [{ actor: "system", action: "case.created", reason: "application received", ts: "2026-11-09T00:00:00.000Z", before: { contact: EMAIL }, after: {} }],
    }) as unknown as CaseDetail;

  it("hides the applicant's documents and any duplicate pair that involves one, and says how many there are", () => {
    const d = detail();
    d.case.docUrls = ["/api/ops/photo?path=cases%2FC-1%2Fdoc-1.jpg"];
    d.dupPhotos = [
      { caseId: "C-0", thisUrl: "/api/ops/photo?path=cases%2FC-1%2Fdoc-1.jpg", otherUrl: "/api/ops/photo?path=cases%2FC-0%2Fphoto-1.jpg" },
      { caseId: "C-0", thisUrl: "/api/ops/photo?path=cases%2FC-1%2Fphoto-1.jpg", otherUrl: "/api/ops/photo?path=cases%2FC-0%2Fdoc-1.jpg" },
      { caseId: "C-0", thisUrl: "/api/ops/photo?path=cases%2FC-1%2Fphoto-1.jpg", otherUrl: "/api/ops/photo?path=cases%2FC-0%2Fphoto-2.jpg" },
    ];
    const v = viewerDetail(d);
    expect(v.case.docUrls).toEqual([]);
    expect(v.case.privateDocCount).toBe(1);
    expect(v.dupPhotos).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain("doc-1");
  });

  it("shows the panel's ledger line as the ledger publishes it: no tier number, nothing about health", () => {
    const d = detail();
    d.case.aiDecision = {
      eligibility: "eligible",
      tier: 4,
      recommendedAmountCents: 55_000,
      confidence: 0.9,
      reasons: [],
      redFlags: [],
      followUpQuestions: [],
      applicantLanguage: "en",
      ledgerSummary: "Family of 5 displaced to a motel; child with asthma lost meds; Tier 4.",
    };
    expect(viewerDetail(d).case.aiDecision?.ledgerSummary).toBe("Family of 5 displaced to a motel");
  });

  it("keeps what the panel draws and drops everything else", () => {
    const v = viewerDetail(detail());
    expect(v.case.contact).toBeNull();
    expect(v.case.timestamps.created).toBe("2026-11-09T00:00:00.000Z");
    expect(v.case.photoUrls).toHaveLength(1);
    expect(v.case.applicantMessage?.text).toBe("Please send proof of residence.");
    expect(v.payout?.status).toBe("create_failed");
    const text = JSON.stringify(v);
    for (const secret of ["0123456789abcdef", "photoHashes", EMAIL, "Marisol", "Whitfield", "555-0142", "recipientEmail", "senderBatchId", "before"]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});

describe("viewerRow and viewerRun", () => {
  it("blanks the name and email of a row and keeps the rest", () => {
    const row = { id: "C-1", status: "paid", name: NAME, email: EMAIL, zip: "28501", ledgerSummary: "Flooded kitchen, household of 3." } as OpsRow;
    expect(viewerRow(row)).toMatchObject({ id: "C-1", status: "paid", name: "", email: "", zip: "28501", ledgerSummary: "Flooded kitchen, household of 3." });
  });

  it("scrubs the applicant's name and contact details out of a summary stored before the evaluation did", () => {
    const row = { id: "C-1", status: "paid", name: NAME, email: EMAIL, ledgerSummary: `${NAME}'s kitchen flooded; call ${EMAIL}.` } as OpsRow;
    const summary = viewerRow(row).ledgerSummary;
    for (const part of [...NAME.split(" "), EMAIL]) expect(summary, part).not.toContain(part);
    expect(summary).toContain("kitchen flooded");
  });

  it("keeps which tool ran on which case and under which clause, and drops what it was given and what it returned", () => {
    const run: OpsRun = {
      id: "r1",
      trigger: "case.created",
      caseId: "C-1",
      status: "done",
      summary: `C-1 paid under P-9; applicant wrote from ${EMAIL}.`,
      cost: { inputTokens: 10, outputTokens: 5, modelCalls: 1 },
      ts: "2026-11-09T00:00:00.000Z",
      finishedAt: "2026-11-09T00:00:05.000Z",
      toolCalls: [
        { name: "get_case", args: { caseId: "C-1", note: PHONE }, policyClause: "P-3", ms: 12, at: "2026-11-09T00:00:01.000Z", error: null, result: { narrative: `${NAME} ${PHONE}` } },
        { name: "get_fund_balance", args: {}, policyClause: null, ms: 3, at: "2026-11-09T00:00:02.000Z", error: `failed for ${EMAIL}`, result: null },
      ],
    };
    const v = viewerRun(run);
    expect(v.toolCalls).toEqual([
      { name: "get_case", args: { caseId: "C-1" }, policyClause: "P-3", ms: 12, at: "2026-11-09T00:00:01.000Z", error: null, result: null },
      { name: "get_fund_balance", args: {}, policyClause: null, ms: 3, at: "2026-11-09T00:00:02.000Z", error: "failed for [redacted]", result: null },
    ]);
    expect(v.summary).toBe("C-1 paid under P-9; applicant wrote from [redacted].");
    expect(v.cost).toEqual(run.cost);
  });
});

describe("scrubContactText", () => {
  it("removes emails and phone numbers and leaves dates alone", () => {
    expect(scrubContactText(`Write to ${EMAIL} or call ${PHONE}.`)).toBe("Write to [redacted] or call [redacted].");
    expect(scrubContactText("[Update 2026-11-09] Here is my lease.")).toBe("[Update 2026-11-09] Here is my lease.");
    expect(scrubContactText("Flooded on 2026-11-01, call +1 252 555 0142")).toBe("Flooded on 2026-11-01, call [redacted]");
    expect(scrubContactText("2026-11-01 2525550142")).toBe("2026-11-01[redacted]");
    expect(scrubContactText("(seen 2026-11-09) and (2026-11-09)")).toBe("(seen 2026-11-09) and (2026-11-09)");
  });
});

describe("sharedForViewers", () => {
  it("loads once for everyone inside the window, again after it, and does not keep a failure", async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect(await sharedForViewers("k", 3000, load, 1_000)).toBe(1);
    expect(await sharedForViewers("k", 3000, load, 3_999)).toBe(1);
    expect(await sharedForViewers("k", 3000, load, 4_000)).toBe(2);
    expect(await sharedForViewers("other", 3000, load, 4_000)).toBe(3);

    const failing = sharedForViewers("bad", 3000, async () => Promise.reject(new Error("db down")), 5_000);
    await expect(failing).rejects.toThrow("db down");
    expect(await sharedForViewers("bad", 3000, async () => "ok", 5_001)).toBe("ok");
  });

  it("visitors share one read of the queue, while an operator always reads fresh data", async () => {
    await seed();
    await getCases();
    await db.collection("cases").doc("C-OPEN").update({ status: "rejected" });
    const stale = JSON.stringify(await body(await getCases()));
    expect(stale).toContain("needs_review");

    signIn();
    const fresh = JSON.stringify(await body(await getCases()));
    expect(fresh).toContain("rejected");
  });
});
