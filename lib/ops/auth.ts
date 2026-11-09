// Operator console authentication: one shared password (ADMIN_PASSWORD), a signed cookie, no accounts.
// Multi-user auth is out of scope for the demo; every human action is still audited as `human:ops`.
// In the demo the console may also be open to look at (OPS_PUBLIC_VIEW); acting always needs the session.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import type { AuditActor } from "@/lib/db/types";

export const OPS_COOKIE = "ops_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
export const OPS_ACTOR: AuditActor = "human:ops";

function sign(issuedAt: number): string {
  return createHmac("sha256", getEnv().AGENT_INTERNAL_SECRET).update(`ops:${issuedAt}`).digest("hex");
}

export function makeSessionValue(now = Date.now()): string {
  return `${now}.${sign(now)}`;
}

export function verifySessionValue(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [ts, sig] = value.split(".");
  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt) || !sig) return false;
  if (now - issuedAt > SESSION_MS || issuedAt > now + 60_000) return false;
  const expected = Buffer.from(sign(issuedAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function passwordMatches(given: string): boolean {
  // Hashing both first gives equal lengths, so neither the comparison nor an early return tells the length.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(getEnv().ADMIN_PASSWORD).digest();
  return timingSafeEqual(a, b);
}

/** True when the request carries a valid operator session cookie. */
export async function isOperator(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionValue(jar.get(OPS_COOKIE)?.value);
}

/**
 * Who is asking. An `operator` is signed in and may act. A `viewer` is a visitor of the open demo console
 * (OPS_PUBLIC_VIEW): they may look, with contact details hidden, and change nothing. `none` must sign in first.
 */
export type OpsAccess = "operator" | "viewer" | "none";

export async function opsAccess(): Promise<OpsAccess> {
  if (await isOperator()) return "operator";
  return getEnv().OPS_PUBLIC_VIEW ? "viewer" : "none";
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: SESSION_MS / 1000 };
}
