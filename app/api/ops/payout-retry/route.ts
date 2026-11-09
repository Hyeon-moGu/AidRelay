// Operators only: send again a payout PayPal did not accept, or never answered. It is the same request
// (same sender_batch_id), so PayPal cannot pay the case twice; see retryFailedPayout.
import { z } from "zod";
import { GuardrailError } from "@/lib/agent/guardrails";
import { InsufficientFundsError } from "@/lib/db/repos/fund";
import { retryFailedPayout } from "@/lib/db/repos/payouts";
import { fail, handleRouteError, ok, parseJson } from "@/lib/http";
import { isOperator, OPS_ACTOR } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ caseId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const { caseId } = await parseJson(req, Body);
    const payout = await retryFailedPayout(caseId, OPS_ACTOR);
    return ok({ caseId, status: payout.status, payoutBatchId: payout.payoutBatchId ?? null });
  } catch (err) {
    // The request was understood and refused by a rule: say which, instead of "internal error".
    if (err instanceof GuardrailError || err instanceof InsufficientFundsError) return fail(err.message, 409);
    return handleRouteError(err, "ops/payout-retry");
  }
}
