import { getCase } from "@/lib/db/repos/cases";
import { listAuditForCase } from "@/lib/db/repos/audit";
import { getPayout } from "@/lib/db/repos/payouts";
import { fail, handleRouteError, ok } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const { id } = await ctx.params;
    const c = await getCase(id);
    if (!c) return fail("case not found", 404);
    const [audit, payout] = await Promise.all([listAuditForCase(id, 40), getPayout(id)]);
    return ok({
      case: {
        ...c,
        timestamps: Object.fromEntries(Object.entries(c.timestamps).map(([k, v]) => [k, v?.toDate().toISOString() ?? null])),
        applicantMessage: c.applicantMessage ? { ...c.applicantMessage, at: c.applicantMessage.at.toDate().toISOString() } : null,
        humanDecision: c.humanDecision ? { ...c.humanDecision, at: c.humanDecision.at.toDate().toISOString() } : null,
        evaluatingSince: c.evaluatingSince?.toDate().toISOString() ?? null,
        notes: (c.notes ?? []).map((n) => ({ ...n, at: n.at.toDate().toISOString() })),
        photoUrls: c.photos.map((p) => `/api/ops/photo?path=${encodeURIComponent(p)}`),
        docUrls: c.docs.map((p) => `/api/ops/photo?path=${encodeURIComponent(p)}`),
      },
      payout: payout
        ? { ...payout, createdAt: payout.createdAt.toDate().toISOString(), updatedAt: payout.updatedAt.toDate().toISOString(), events: payout.events.map((e) => ({ ...e, at: e.at.toDate().toISOString() })) }
        : null,
      audit: audit.map((a) => ({ ...a, ts: a.ts.toDate().toISOString() })),
    });
  } catch (err) {
    return handleRouteError(err, "ops/case");
  }
}
