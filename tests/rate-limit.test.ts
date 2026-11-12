// Limits on the public routes that cost money: per client and site-wide, all-or-nothing, no raw IPs stored.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "./helpers/fake-firestore";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/firestore")>();
  return { ...actual, getDb: () => state.db };
});

import { clientIp, evaluate, LIMITS, takeSlots } from "@/lib/rate-limit";

const HOUR = 60 * 60_000;
let db: FakeFirestore;
const apply = (ip: string) => [
  { name: "apply-ip", key: ip, windows: LIMITS.applyPerIp },
  { name: "apply-all", key: "all", windows: LIMITS.applyAll },
];

beforeEach(() => {
  db = new FakeFirestore();
  state.db = db;
});

describe("evaluate", () => {
  it("lets old hits fall out of the window and says how long to wait", () => {
    const now = 10 * HOUR;
    const windows = [{ ms: HOUR, max: 3 }];
    expect(evaluate([now - 2 * HOUR, now - 10, now - 20], windows, now).retryAfterMs).toBeNull();
    expect(evaluate([now - 30 * 60_000, now - 20, now - 10], windows, now).retryAfterMs).toBe(30 * 60_000);
  });
});

describe("takeSlots", () => {
  it("allows 3 applications an hour from one IP, then refuses", async () => {
    const t0 = Date.UTC(2026, 10, 12, 0, 0, 0);
    for (let i = 0; i < 3; i++) expect((await takeSlots(apply("1.2.3.4"), t0 + i * 60_000)).ok).toBe(true);
    const fourth = await takeSlots(apply("1.2.3.4"), t0 + 4 * 60_000);
    expect(fourth).toMatchObject({ ok: false, bucket: "apply-ip" });
    // Another IP is not affected.
    expect((await takeSlots(apply("5.6.7.8"), t0 + 4 * 60_000)).ok).toBe(true);
  });

  it("allows 5 a day from one IP even when spread over hours", async () => {
    const t0 = Date.UTC(2026, 10, 12, 0, 0, 0);
    for (let i = 0; i < 5; i++) expect((await takeSlots(apply("1.2.3.4"), t0 + i * 2 * HOUR)).ok).toBe(true);
    expect(await takeSlots(apply("1.2.3.4"), t0 + 11 * HOUR)).toMatchObject({ ok: false, bucket: "apply-ip" });
    expect((await takeSlots(apply("1.2.3.4"), t0 + 25 * HOUR)).ok).toBe(true);
  });

  it("caps the whole site at 100 a day, whatever the IPs", async () => {
    const t0 = Date.UTC(2026, 10, 12, 0, 0, 0);
    for (let i = 0; i < 100; i++) expect((await takeSlots(apply(`10.0.0.${i}`), t0 + i)).ok).toBe(true);
    expect(await takeSlots(apply("10.0.1.1"), t0 + 200)).toMatchObject({ ok: false, bucket: "apply-all" });
  });

  it("counts nothing when one bucket is full, and stores no raw IP", async () => {
    const t0 = Date.UTC(2026, 10, 12, 0, 0, 0);
    for (let i = 0; i < 3; i++) await takeSlots(apply("1.2.3.4"), t0 + i);
    await takeSlots(apply("1.2.3.4"), t0 + 10);
    const docs = db.all("rate_limits") as Array<{ bucket: string; hits: number[] }>;
    expect(docs.find((d) => d.bucket === "apply-all")?.hits).toHaveLength(3);
    expect(JSON.stringify(docs)).not.toContain("1.2.3.4");
  });
});

describe("clientIp", () => {
  it("takes the first X-Forwarded-For entry", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }))).toBe("203.0.113.7");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
