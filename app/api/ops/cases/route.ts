import { listAllCases } from "@/lib/db/repos/cases";
import { getFund } from "@/lib/db/repos/fund";
import { fundBalanceCents } from "@/lib/db/types";
import { fail, handleRouteError, ok } from "@/lib/http";
import { opsAccess } from "@/lib/ops/auth";
import { sharedForViewers, viewerRow } from "@/lib/ops/public-view";
import { toRow } from "@/lib/ops/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadQueue() {
  const [cases, fund] = await Promise.all([listAllCases(), getFund()]);
  return {
    rows: cases.map(toRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    fund: { currency: fund.currency, raisedCents: fund.raisedCents, paidCents: fund.paidCents, reservedCents: fund.reservedCents, balanceCents: fundBalanceCents(fund) },
  };
}

export async function GET() {
  try {
    const access = await opsAccess();
    if (access === "none") return fail("sign in first", 401);
    if (access === "operator") return ok(await loadQueue());
    // Visitors of the open demo console share one read every few seconds and never receive names or emails.
    const queue = await sharedForViewers("cases", 3000, async () => {
      const q = await loadQueue();
      return { ...q, rows: q.rows.map(viewerRow) };
    });
    return ok(queue);
  } catch (err) {
    return handleRouteError(err, "ops/cases");
  }
}
