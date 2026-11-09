"use client";

// Side panel: the photos, the applicant's story, the AI decision with its clauses, and the audit trail.
import { Images, LoaderCircle, Lock, RotateCw, X } from "lucide-react";
import { Chip, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { clock, money } from "@/lib/format";
import type { Decision } from "@/lib/agent/schema";

export interface CaseDetail {
  case: {
    id: string;
    status: string;
    lang: string;
    zip: string;
    householdSize: number | null;
    requestedAmountCents: number | null;
    narrative: string;
    contact: { name: string; email: string; phone?: string | null; address?: string | null };
    tier?: number | null;
    aiDecision?: Decision;
    aiDecisionSecond?: Decision;
    secondEvaluationAgrees?: boolean;
    usableEvidenceCount?: number;
    approvedAmountCents?: number;
    humanDecision: { approved: boolean; by: string; amountCents?: number; note?: string; at: string } | null;
    redFlags?: string[];
    dupMatches?: Array<{ caseId: string; by: string[] }>;
    applicantMessage: { lang: string; text: string; at: string } | null;
    reservedCents?: number;
    payoutBatchId?: string;
    notes: Array<{ by: string; text: string; at: string }>;
    timestamps: Record<string, string | null>;
    photoUrls: string[];
    docUrls: string[];
  };
  /** P-4 photo matches: the file in this case and the same photo in the earlier case. */
  dupPhotos?: Array<{ caseId: string; thisUrl: string; otherUrl: string }>;
  payout: {
    status: string;
    outcome: string;
    batchStatus?: string;
    payoutBatchId?: string;
    amountCents: number;
    error?: string;
    /** PayPal did not accept the payout, or never answered: an operator may send it again. */
    retryable?: boolean;
    events: Array<{ type: string; status?: string; source: string; at: string }>;
  } | null;
  audit: Array<{ actor: string; action: string; policyClause?: string; reason: string; ts: string }>;
}

const orDash = (s: string) => s || "–";

function DecisionBlock({ d, title }: { d: Decision; title: string }) {
  return (
    <section className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="flex flex-wrap gap-1">
          <Chip tone={d.eligibility === "eligible" ? "success" : d.eligibility === "ineligible" ? "danger" : "warning"}>{d.eligibility.replace(/_/g, " ")}</Chip>
          <Chip>tier {d.tier ?? "–"}</Chip>
          <Chip className="tabular-nums">{Math.round(d.confidence * 100)}%</Chip>
        </span>
      </div>
      <ul className="space-y-1.5 text-[13px] leading-snug">
        {d.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <Chip tone="accent" mono className="h-fit shrink-0">
              {r.clause}
            </Chip>
            <span>{r.evidence}</span>
          </li>
        ))}
      </ul>
      {d.redFlags.length > 0 && (
        <p className="flex flex-wrap gap-1">
          {d.redFlags.map((f) => (
            <Chip key={f} tone="danger">
              {f.replace(/_/g, " ")}
            </Chip>
          ))}
        </p>
      )}
      {d.followUpQuestions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-muted-foreground">
          {d.followUpQuestions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Ledger line:</span> {d.ledgerSummary}
      </p>
    </section>
  );
}

export function CasePanel({
  detail,
  onClose,
  onRetryPayout,
  retrying,
}: {
  detail: CaseDetail | null;
  onClose: () => void;
  /** Sends again a payout PayPal did not accept; the button shows only when the payout allows it. */
  onRetryPayout?: (caseId: string) => void;
  retrying?: boolean;
}) {
  if (!detail) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Click a row to see the photos, the AI reasoning and the audit trail.</p>;
  }
  const c = detail.case;
  const media = [...c.photoUrls, ...c.docUrls];
  return (
    <div className="animate-relay-in space-y-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-mono text-base font-semibold" translate="no">
            {c.id}
          </h3>
          <StatusBadge status={c.status} />
        </div>
        <button type="button" aria-label="Close the case" onClick={onClose} className="-m-1 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="rounded-lg bg-muted/70 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Lock aria-hidden="true" className="size-3.5" />
          Private. Never sent to the model or the ledger.
        </p>
        <p className="mt-1.5 font-medium">{c.contact.name}</p>
        <p className="truncate text-muted-foreground" translate="no">
          {c.contact.email}
          {c.contact.phone ? ` · ${c.contact.phone}` : ""}
        </p>
        <p className="text-muted-foreground">{c.contact.address ?? "No address given"}</p>
      </div>

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {media.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Evidence ${i + 1} for ${c.id}`} width={120} height={112} loading="lazy" className="h-28 w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {detail.dupPhotos?.map((d) => (
        <section key={d.caseId} aria-label={`Photo also used in case ${d.caseId}`} className="rounded-lg border border-danger/30 bg-danger-soft/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <Images aria-hidden="true" className="size-3.5" />
            Same photo as an earlier application
            <Chip tone="accent" mono className="ml-auto">
              P-4
            </Chip>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                [d.thisUrl, `This case, ${c.id}`],
                [d.otherUrl, `${d.caseId}, applied earlier`],
              ] as const
            ).map(([url, caption]) => (
              <figure key={url} className="min-w-0">
                <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={caption} width={170} height={112} loading="lazy" className="h-28 w-full object-cover" />
                </a>
                <figcaption className="mt-1 truncate text-[11px] text-muted-foreground">{caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Applicant’s words, treated as untrusted data</p>
        <p className="max-h-48 overflow-y-auto overscroll-contain rounded-lg bg-muted/70 p-3 leading-relaxed whitespace-pre-line">{c.narrative}</p>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Zip · household</dt>
        <dd className="tabular-nums">
          {c.zip} · {c.householdSize ?? "?"} people
        </dd>
        <dt className="text-muted-foreground">Asked for</dt>
        <dd className="tabular-nums">{orDash(money(c.requestedAmountCents))}</dd>
        <dt className="text-muted-foreground">Amount on file</dt>
        <dd className="font-medium tabular-nums">
          {orDash(money(c.humanDecision?.amountCents ?? c.approvedAmountCents ?? c.aiDecision?.recommendedAmountCents))}
          {c.reservedCents ? <span className="font-normal text-muted-foreground"> · reserved {money(c.reservedCents)}</span> : null}
        </dd>
        <dt className="text-muted-foreground">Evidence</dt>
        <dd>{c.usableEvidenceCount == null ? "–" : `${c.usableEvidenceCount} usable photo(s) or document(s)`}</dd>
        <dt className="text-muted-foreground">Duplicates</dt>
        <dd>{c.dupMatches?.length ? c.dupMatches.map((d) => `${d.caseId} (${d.by.join(", ")})`).join("; ") : "none"}</dd>
        <dt className="text-muted-foreground">Second evaluation</dt>
        <dd>{c.secondEvaluationAgrees == null ? "not run" : c.secondEvaluationAgrees ? "agrees" : "differs"}</dd>
        {c.humanDecision && (
          <>
            <dt className="text-muted-foreground">Volunteer</dt>
            <dd>
              {c.humanDecision.approved ? "approved" : "rejected"} by <span className="font-mono">{c.humanDecision.by}</span>
              {c.humanDecision.amountCents ? ` for ${money(c.humanDecision.amountCents)}` : ""}
              {c.humanDecision.note ? ` · ${c.humanDecision.note}` : ""}
            </dd>
          </>
        )}
        {detail.payout && (
          <>
            <dt className="text-muted-foreground">Payout</dt>
            <dd>
              {detail.payout.status.toLowerCase()} ({detail.payout.outcome.replace(/_/g, " ")}) · {money(detail.payout.amountCents)}
              {detail.payout.payoutBatchId && (
                <>
                  {" "}
                  · <span className="font-mono">{detail.payout.payoutBatchId}</span>
                </>
              )}
              {detail.payout.error ? <span className="text-danger"> · {detail.payout.error}</span> : null}
            </dd>
          </>
        )}
      </dl>

      {detail.payout?.retryable && onRetryPayout && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft/60 p-3 text-[13px]">
          <p className="font-medium text-danger">{detail.payout.status === "create_failed" ? "PayPal did not accept this payout" : "PayPal never answered for this payout"}</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            {c.reservedCents ? `${money(c.reservedCents)} is still reserved for this case. ` : ""}
            Sending it again repeats the same payout with the same PayPal batch id, so the family cannot be paid twice.
          </p>
          <Button size="sm" className="mt-2.5" disabled={retrying} onClick={() => onRetryPayout(c.id)}>
            {retrying ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RotateCw aria-hidden="true" />}
            Send payout again
          </Button>
        </div>
      )}

      {c.applicantMessage && c.status === "needs_info" && (
        <div className="rounded-lg bg-warning-soft p-3 text-[13px]">
          <p className="font-medium text-warning">Message shown to the applicant ({c.applicantMessage.lang})</p>
          <p className="mt-1 leading-relaxed whitespace-pre-line">{c.applicantMessage.text}</p>
        </div>
      )}

      {c.aiDecision && <DecisionBlock d={c.aiDecision} title="Case Officer decision" />}
      {c.aiDecisionSecond && <DecisionBlock d={c.aiDecisionSecond} title="Second, independent evaluation" />}

      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          Audit trail <span className="tabular-nums">({detail.audit.length})</span>
        </summary>
        <ol className="space-y-1.5 border-t border-border px-3 py-2.5 text-xs">
          {detail.audit.map((a, i) => (
            <li key={i} className="leading-relaxed">
              <span className="text-muted-foreground tabular-nums">{clock(a.ts)}</span> <span className="font-mono">{a.actor}</span> {a.action.replace(/_/g, " ")}
              {a.policyClause && (
                <Chip tone="accent" mono className="ml-1">
                  {a.policyClause}
                </Chip>
              )}
              <span className="text-muted-foreground"> · {a.reason}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
