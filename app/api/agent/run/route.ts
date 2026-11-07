// Internal: run the Case Officer for an event. Protected by AGENT_INTERNAL_SECRET.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runCaseOfficer } from "@/lib/agent/officer";
import { AGENT_TRIGGERS } from "@/lib/agent/trigger";
import { getEnv } from "@/lib/env";
import { fail, handleRouteError, ok, parseJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  trigger: z.enum(AGENT_TRIGGERS),
  caseId: z.string().optional(),
  orderId: z.string().optional(),
  eventId: z.string().optional(),
  command: z.string().max(500).optional(),
});

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    if (!secretMatches(req.headers.get("x-agent-secret"), getEnv().AGENT_INTERNAL_SECRET)) {
      return fail("unauthorized", 401);
    }
    const body = await parseJson(req, Body);
    const result = await runCaseOfficer(body);
    return ok(result);
  } catch (err) {
    return handleRouteError(err, "agent/run");
  }
}
