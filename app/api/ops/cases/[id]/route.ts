import { matchingPhotoPair } from "@/lib/agent/evaluate";
import { getCase } from "@/lib/db/repos/cases";
import { listAuditForCase } from "@/lib/db/repos/audit";
import { getPayout, payoutIsRetryable } from "@/lib/db/repos/payouts";
import { fail, handleRouteError, ok } from "@/lib/http";
import { isOperator } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private photos reach a signed-in operator through /api/ops/photo. */
const photoUrl = (path: string) => `/api/ops/photo?path=${encodeURIComponent(path)}`;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isOperator())) return fail("sign in first", 401);
    const { id } = await ctx.params;
    const c = await getCase(id);
    if (!c) return fail("case not found", 404);
    const [audit, payout] = await Promise.all([listAuditForCase(id, 40), getPayout(id)]);
    // P-4 photo matches as a pair of images the panel shows side by side.
    const dupPhotos: Array<{ caseId: string; thisUrl: string; otherUrl: string }> = [];
    for (const match of c.dupMatches ?? []) {
      if (!match.by.includes("photo")) continue;
      const other = await getCase(match.caseId);
      const pair = other ? matchingPhotoPair(c, other) : null;
      if (pair) dupPhotos.push({ caseId: match.caseId, thisUrl: photoUrl(pair.thisPath), otherUrl: photoUrl(pair.otherPath) });
    }
    return ok({
      dupPhotos,
      case: {
        ...c,
        timestamps: Object.fromEntries(Object.entries(c.timestamps).map(([k, v]) => [k, v?.toDate().toISOString() ?? null])),
        applicantMessage: c.applicantMessage ? { ...c.applicantMessage, at: c.applicantMessage.at.toDate().toISOString() } : null,
        humanDecision: c.humanDecision ? { ...c.humanDecision, at: c.humanDecision.at.toDate().toISOString() } : null,
        evaluatingSince: c.evaluatingSince?.toDate().toISOString() ?? null,
        notes: (c.notes ?? []).map((n) => ({ ...n, at: n.at.toDate().toISOString() })),
        photoUrls: c.photos.map(photoUrl),
        docUrls: c.docs.map(photoUrl),
      },
      payout: payout
        ? {
            ...payout,
            createdAt: payout.createdAt.toDate().toISOString(),
            updatedAt: payout.updatedAt.toDate().toISOString(),
            events: payout.events.map((e) => ({ ...e, at: e.at.toDate().toISOString() })),
            // PayPal did not accept it, or never answered: the panel offers to send it again.
            retryable: payoutIsRetryable(payout),
          }
        : null,
      audit: audit.map((a) => ({ ...a, ts: a.ts.toDate().toISOString() })),
    });
  } catch (err) {
    return handleRouteError(err, "ops/case");
  }
}
