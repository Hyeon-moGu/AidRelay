import { listAllCases } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import { fundBalanceCents } from "@/lib/db/types";
import { fail, handleRouteError, ok } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";
import { toRow } from "@/lib/ops/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const [cases, fund] = await Promise.all([listAllCases(), getFund()]);
    return ok({
      rows: cases.map(toRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      fund: { currency: fund.currency, raisedCents: fund.raisedCents, paidCents: fund.paidCents, reservedCents: fund.reservedCents, balanceCents: fundBalanceCents(fund) },
    });
  } catch (err) {
    return handleRouteError(err, "ops/cases");
  }
}
