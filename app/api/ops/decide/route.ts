import { fail, handleRouteError, ok, parseJson } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";
import { applyHumanDecision, DecisionRequestSchema } from "@/lib/ops/decide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const body = await parseJson(req, DecisionRequestSchema);
    return ok(await applyHumanDecision(body));
  } catch (err) {
    return handleRouteError(err, "ops/decide");
  }
}
