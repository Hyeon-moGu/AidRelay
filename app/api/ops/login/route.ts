import { cookies } from "next/headers";
import { z } from "zod";
import { fail, handleRouteError, ok, parseJson } from "@/lib/http";
import { makeSessionValue, OPS_COOKIE, passwordMatches, sessionCookieOptions } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const { password } = await parseJson(req, Body);
    if (!passwordMatches(password)) return fail("wrong password", 401);
    const jar = await cookies();
    jar.set(OPS_COOKIE, makeSessionValue(), sessionCookieOptions(new URL(req.url).protocol === "https:"));
    return ok({ signedIn: true });
  } catch (err) {
    return handleRouteError(err, "ops/login");
  }
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(OPS_COOKIE);
  return ok({ signedIn: false });
}
