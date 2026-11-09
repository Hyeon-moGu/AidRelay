// What a visitor of the open demo console receives. With OPS_PUBLIC_VIEW on, anyone may look at /ops without
// signing in; the functions here decide what leaves the server for them. Each one builds its answer field by
// field, so a field added to a case later stays private until someone adds it here: contact details, the
// applicant's private status link and the payout recipient never go out, and free text is scrubbed.
import type { Decision } from "@/lib/agent/schema";
import { redactPhoneMatch, scrubIdentity } from "@/lib/ledger/anonymize";
import type { CaseDetail, OpsRow, OpsRun } from "@/lib/ops/rows";

const REDACTED = "[redacted]";
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /\(?\+?\d[\d\s().-]{5,}\d/g;

/**
 * Removes emails and phone numbers from text a visitor will read. A date such as the "[Update 2026-11-09]"
 * stamp on an applicant's reply looks like a phone number to the pattern and is left alone.
 */
export function scrubContactText(text: string): string {
  return text.replace(EMAIL_RE, REDACTED).replace(PHONE_RE, redactPhoneMatch);
}

/**
 * A queue row without the applicant's name and email. The summary is scrubbed again on the way out, as the
 * public ledger does, so a line stored before the evaluation scrubbed names is covered too.
 */
export function viewerRow(row: OpsRow): OpsRow {
  return { ...row, ledgerSummary: scrubContactText(scrubIdentity(row.ledgerSummary, { name: row.name })), name: "", email: "" };
}

/** The case panel's data without contact details, and with the applicant's own name and address scrubbed from free text. */
export function viewerDetail(d: CaseDetail): CaseDetail {
  const c = d.case;
  const clean = (text: string) => scrubContactText(scrubIdentity(text, c.contact ?? {}));
  const decision = (x: Decision | undefined): Decision | undefined =>
    x && {
      ...x,
      reasons: x.reasons.map((r) => ({ ...r, evidence: clean(r.evidence) })),
      followUpQuestions: x.followUpQuestions.map(clean),
      ledgerSummary: clean(x.ledgerSummary),
    };
  return {
    dupPhotos: d.dupPhotos?.map((p) => ({ caseId: p.caseId, thisUrl: p.thisUrl, otherUrl: p.otherUrl })),
    case: {
      id: c.id,
      status: c.status,
      lang: c.lang,
      zip: c.zip,
      householdSize: c.householdSize,
      requestedAmountCents: c.requestedAmountCents,
      narrative: clean(c.narrative),
      contact: null,
      tier: c.tier,
      aiDecision: decision(c.aiDecision),
      aiDecisionSecond: decision(c.aiDecisionSecond),
      secondEvaluationAgrees: c.secondEvaluationAgrees,
      usableEvidenceCount: c.usableEvidenceCount,
      approvedAmountCents: c.approvedAmountCents,
      humanDecision: c.humanDecision && {
        approved: c.humanDecision.approved,
        by: c.humanDecision.by,
        amountCents: c.humanDecision.amountCents,
        note: c.humanDecision.note === undefined ? undefined : clean(c.humanDecision.note),
        at: c.humanDecision.at,
      },
      redFlags: c.redFlags,
      dupMatches: c.dupMatches?.map((m) => ({ caseId: m.caseId, by: m.by })),
      applicantMessage: c.applicantMessage && { lang: c.applicantMessage.lang, text: clean(c.applicantMessage.text), at: c.applicantMessage.at },
      reservedCents: c.reservedCents,
      payoutBatchId: c.payoutBatchId,
      notes: c.notes.map((n) => ({ by: n.by, text: clean(n.text), at: n.at })),
      timestamps: c.timestamps,
      photoUrls: c.photoUrls,
      docUrls: c.docUrls,
    },
    payout: d.payout && {
      status: d.payout.status,
      outcome: d.payout.outcome,
      batchStatus: d.payout.batchStatus,
      payoutBatchId: d.payout.payoutBatchId,
      amountCents: d.payout.amountCents,
      error: d.payout.error === undefined ? undefined : clean(d.payout.error),
      retryable: d.payout.retryable,
      events: d.payout.events.map((e) => ({ type: e.type, status: e.status, source: e.source, at: e.at })),
    },
    audit: d.audit.map((a) => ({ actor: a.actor, action: a.action, policyClause: a.policyClause, reason: clean(a.reason), ts: a.ts })),
  };
}

/** An agent run as the activity feed draws it: which tools ran on which case and under which clause, not what they returned. */
export function viewerRun(r: OpsRun): OpsRun {
  return {
    id: r.id,
    trigger: r.trigger,
    caseId: r.caseId,
    status: r.status,
    summary: scrubContactText(r.summary),
    cost: r.cost,
    ts: r.ts,
    finishedAt: r.finishedAt,
    toolCalls: r.toolCalls.map((t) => {
      const caseId = typeof t.args === "object" && t.args !== null && "caseId" in t.args ? (t.args as { caseId: unknown }).caseId : undefined;
      return {
        name: t.name,
        args: typeof caseId === "string" ? { caseId } : {},
        policyClause: t.policyClause,
        ms: t.ms,
        at: t.at,
        error: t.error === null ? null : scrubContactText(t.error),
        result: null,
      };
    }),
  };
}

const MAX_SHARED_ENTRIES = 500;
const shared = new Map<string, { at: number; ttlMs: number; value: Promise<unknown> }>();

/**
 * One load per `ttlMs` for all visitors together, so an open console cannot multiply database reads however
 * many people (or scripts) are looking. Operators do not go through this: they always read fresh data.
 */
export function sharedForViewers<T>(key: string, ttlMs: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = shared.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  for (const [k, entry] of shared) if (now - entry.at >= entry.ttlMs) shared.delete(k);
  if (shared.size >= MAX_SHARED_ENTRIES) shared.clear();
  const value = load();
  shared.set(key, { at: now, ttlMs, value });
  // A failed load is not kept: the next visitor tries again.
  value.catch(() => {
    if (shared.get(key)?.value === value) shared.delete(key);
  });
  return value;
}

/** For tests. */
export function clearSharedForViewers(): void {
  shared.clear();
}
