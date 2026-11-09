import { matchingPhotoPair } from "@/lib/agent/evaluate";
import { getCase } from "@/lib/db/repos/cases";
import { listAuditForCase } from "@/lib/db/repos/audit";
import { getPayout, payoutIsRetryable } from "@/lib/db/repos/payouts";
import { fail, handleRouteError, ok } from "@/lib/http";
import { opsAccess } from "@/lib/ops/auth";
import { sharedForViewers, viewerDetail } from "@/lib/ops/public-view";
import type { CaseDetail } from "@/lib/ops/rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The status an audit entry's before/after records, when it records one. */
const statusOf = (v: unknown): string | undefined => {
  const status = (v as { status?: unknown } | null | undefined)?.status;
  return typeof status === "string" ? status : undefined;
};

/** Applicant photos are served by /api/ops/photo, never from a public bucket. */
const photoUrl = (path: string) => `/api/ops/photo?path=${encodeURIComponent(path)}`;

/** Everything an operator sees in the case panel, or null when there is no such case. */
async function loadDetail(id: string): Promise<CaseDetail | null> {
  const c = await getCase(id);
  if (!c) return null;
  const [audit, payout] = await Promise.all([listAuditForCase(id, 40), getPayout(id)]);
  // P-4 photo matches as a pair of images the panel shows side by side.
  const dupPhotos: Array<{ caseId: string; thisUrl: string; otherUrl: string }> = [];
  for (const match of c.dupMatches ?? []) {
    if (!match.by.includes("photo")) continue;
    const other = await getCase(match.caseId);
    const pair = other ? matchingPhotoPair(c, other) : null;
    if (pair) dupPhotos.push({ caseId: match.caseId, thisUrl: photoUrl(pair.thisPath), otherUrl: photoUrl(pair.otherPath) });
  }
  return {
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
          // PayPal did not accept it, or never answered, and the case still waits for it: the panel offers
          // to send it again. (After a refusal the case is back at `approved`; with no answer it is still `paying`.)
          retryable: payoutIsRetryable(payout) && c.status === (payout.status === "create_failed" ? "approved" : "paying"),
        }
      : null,
    audit: audit.map((a) => ({ ...a, ts: a.ts.toDate().toISOString(), from: statusOf(a.before), to: statusOf(a.after) })),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await opsAccess();
    if (access === "none") return fail("sign in first", 401);
    const { id } = await ctx.params;
    if (access === "operator") {
      const detail = await loadDetail(id);
      return detail ? ok(detail) : fail("case not found", 404);
    }
    // A visitor of the open demo console gets the panel without contact details, the private status link or the
    // payout recipient (lib/ops/public-view.ts), and visitors share one read per case every few seconds.
    if (!/^[A-Za-z0-9-]{1,40}$/.test(id)) return fail("case not found", 404);
    const detail = await sharedForViewers(`case:${id}`, 3000, async () => {
      const full = await loadDetail(id);
      return full && viewerDetail(full);
    });
    return detail ? ok(detail) : fail("case not found", 404);
  } catch (err) {
    return handleRouteError(err, "ops/case");
  }
}
