// Request limits for the public routes that cost money (every application and reply is a Claude call) or
// guard a password. Counters live in Firestore, so they hold across Cloud Run instances, and are taken in one
// transaction: either every bucket has room and all are counted, or none is.
// Keys are hashed with the server secret, so no IP address is stored.
import { createHmac } from "node:crypto";
import { col, getDb } from "@/lib/db/firestore";
import { getEnv } from "@/lib/env";

export interface Window {
  ms: number;
  max: number;
}

export interface Bucket {
  /** What is being limited, e.g. "apply-ip". */
  name: string;
  /** Whose requests count together, e.g. the client IP, or "all" for a site-wide cap. */
  key: string;
  windows: Window[];
}

export type SlotResult = { ok: true } | { ok: false; bucket: string; retryAfterSec: number };

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** The limits in use. Small on purpose: this is a demo whose AI calls are paid per request. */
export const LIMITS = {
  /** One person: at most 3 new applications in an hour and 5 in a day. */
  applyPerIp: [{ ms: HOUR, max: 3 }, { ms: DAY, max: 5 }],
  /** The whole site: at most 100 new applications a day, whatever the IPs say. */
  applyAll: [{ ms: DAY, max: 100 }],
  /** Replies to a follow-up question are re-evaluated too. */
  replyPerIp: [{ ms: HOUR, max: 3 }, { ms: DAY, max: 5 }],
  replyAll: [{ ms: DAY, max: 100 }],
  /** Staff sign-in attempts from one IP. */
  loginPerIp: [{ ms: HOUR, max: 10 }],
} satisfies Record<string, Window[]>;

/**
 * The caller's IP as the proxy reports it: the first X-Forwarded-For entry. A client can put anything there, so
 * the per-IP limit is a courtesy limit; the site-wide buckets are what bound the cost.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

function docId(bucket: Bucket): string {
  const hash = createHmac("sha256", getEnv().AGENT_INTERNAL_SECRET).update(`${bucket.name}:${bucket.key}`).digest("hex").slice(0, 32);
  return `${bucket.name}-${hash}`;
}

/** Pure check for one bucket: the hits that still count, and whether one more fits. */
export function evaluate(hits: number[], windows: Window[], now: number): { kept: number[]; retryAfterMs: number | null } {
  const longest = Math.max(...windows.map((w) => w.ms));
  const kept = hits.filter((t) => t > now - longest).sort((a, b) => a - b);
  let retryAfterMs: number | null = null;
  for (const w of windows) {
    const inWindow = kept.filter((t) => t > now - w.ms);
    if (inWindow.length >= w.max) {
      // Room opens when the oldest hit that keeps this window full falls out of it.
      const wait = inWindow[inWindow.length - w.max] + w.ms - now;
      retryAfterMs = Math.max(retryAfterMs ?? 0, wait);
    }
  }
  return { kept, retryAfterMs };
}

/** Takes one slot in every bucket, or none if any bucket is full. */
export async function takeSlots(buckets: Bucket[], now = Date.now()): Promise<SlotResult> {
  const db = getDb();
  const refs = buckets.map((b) => db.collection(col.rateLimits).doc(docId(b)));
  return db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));
    const checks = buckets.map((b, i) => evaluate(((snaps[i].data()?.hits as number[] | undefined) ?? []).slice(), b.windows, now));
    const full = checks.findIndex((c) => c.retryAfterMs !== null);
    if (full >= 0) return { ok: false, bucket: buckets[full].name, retryAfterSec: Math.ceil((checks[full].retryAfterMs ?? 0) / 1000) };
    checks.forEach((c, i) => {
      const longest = Math.max(...buckets[i].windows.map((w) => w.ms));
      tx.set(refs[i], { bucket: buckets[i].name, hits: [...c.kept, now], expiresAt: new Date(now + longest) });
    });
    return { ok: true };
  });
}
