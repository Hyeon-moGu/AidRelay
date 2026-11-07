// Public, no auth: the same data the /ledger page renders, for anyone who wants to audit the fund.
import { handleRouteError, ok } from "@/lib/http";
import { buildLedger } from "@/lib/ledger/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ledger = await buildLedger();
    return ok({ ...ledger, policyMarkdown: undefined, policyUrl: "/ledger#policy" }, { headers: { "Cache-Control": "public, max-age=15" } });
  } catch (err) {
    return handleRouteError(err, "ledger");
  }
}
