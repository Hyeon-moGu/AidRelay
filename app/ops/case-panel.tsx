"use client";

// Side panel: the photos, the applicant's story, the AI decision with its clauses, and the audit trail.
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
  payout: { status: string; outcome: string; batchStatus?: string; payoutBatchId?: string; amountCents: number; error?: string; events: Array<{ type: string; status?: string; source: string; at: string }> } | null;
  audit: Array<{ actor: string; action: string; policyClause?: string; reason: string; ts: string }>;
}

const money = (c: number | null | undefined) => (c == null ? "–" : `$${(c / 100).toFixed(2)}`);

function DecisionBlock({ d, title }: { d: Decision; title: string }) {
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-zinc-500">
          {d.eligibility} · tier {d.tier ?? "–"} · {Math.round(d.confidence * 100)}%
        </span>
      </div>
      <ul className="space-y-1">
        {d.reasons.map((r, i) => (
          <li key={i}>
            <span className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-800">{r.clause}</span> {r.evidence}
          </li>
        ))}
      </ul>
      {d.redFlags.length > 0 && <p className="text-red-700">flags: {d.redFlags.join(", ")}</p>}
      {d.followUpQuestions.length > 0 && (
        <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
          {d.followUpQuestions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-500">ledger: {d.ledgerSummary}</p>
    </div>
  );
}

export function CasePanel({ detail, onClose }: { detail: CaseDetail | null; onClose: () => void }) {
  if (!detail) return <p className="text-sm text-zinc-500">Click a row to see the photos, the AI reasoning and the audit trail.</p>;
  const c = detail.case;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {c.id} <span className="text-sm font-normal text-zinc-500">{c.status.replace("_", " ")}</span>
          </h2>
          <p className="text-zinc-500">
            {c.contact.name} · {c.contact.email}
            {c.contact.phone ? ` · ${c.contact.phone}` : ""}
          </p>
          <p className="text-zinc-500">
            {c.contact.address ?? "no address"} · {c.zip} · household {c.householdSize ?? "?"} · asked {money(c.requestedAmountCents)}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 underline">
          close
        </button>
      </div>

      {(c.photoUrls.length > 0 || c.docUrls.length > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {[...c.photoUrls, ...c.docUrls].map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="h-28 w-full rounded object-cover" />
            </a>
          ))}
        </div>
      )}

      <p className="whitespace-pre-line rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">{c.narrative}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-zinc-500">Amount on file</dt>
        <dd>
          {money(c.humanDecision?.amountCents ?? c.approvedAmountCents ?? c.aiDecision?.recommendedAmountCents)}
          {c.reservedCents ? ` (reserved ${money(c.reservedCents)})` : ""}
        </dd>
        <dt className="text-zinc-500">Evidence</dt>
        <dd>{c.usableEvidenceCount ?? "–"} usable photo(s)/document(s)</dd>
        <dt className="text-zinc-500">Duplicates</dt>
        <dd>{c.dupMatches?.length ? c.dupMatches.map((d) => `${d.caseId} (${d.by.join(", ")})`).join("; ") : "none"}</dd>
        <dt className="text-zinc-500">Second evaluation</dt>
        <dd>{c.secondEvaluationAgrees == null ? "not run" : c.secondEvaluationAgrees ? "agrees" : "differs"}</dd>
        {c.humanDecision && (
          <>
            <dt className="text-zinc-500">Human</dt>
            <dd>
              {c.humanDecision.approved ? "approved" : "rejected"} by {c.humanDecision.by}
              {c.humanDecision.amountCents ? ` for ${money(c.humanDecision.amountCents)}` : ""}
              {c.humanDecision.note ? ` · ${c.humanDecision.note}` : ""}
            </dd>
          </>
        )}
        {detail.payout && (
          <>
            <dt className="text-zinc-500">Payout</dt>
            <dd>
              {detail.payout.status} ({detail.payout.outcome}) {money(detail.payout.amountCents)} · batch {detail.payout.payoutBatchId ?? "–"}
              {detail.payout.error ? ` · ${detail.payout.error}` : ""}
            </dd>
          </>
        )}
      </dl>

      {c.applicantMessage && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs whitespace-pre-line dark:border-amber-700 dark:bg-amber-950">
          <strong>Message to applicant ({c.applicantMessage.lang}):</strong>
          <br />
          {c.applicantMessage.text}
        </div>
      )}

      {c.aiDecision && <DecisionBlock d={c.aiDecision} title="Case Officer decision" />}
      {c.aiDecisionSecond && <DecisionBlock d={c.aiDecisionSecond} title="Second, independent evaluation" />}

      <details>
        <summary className="cursor-pointer text-xs text-zinc-500">Audit trail ({detail.audit.length})</summary>
        <ol className="mt-2 space-y-1 text-xs">
          {detail.audit.map((a, i) => (
            <li key={i}>
              <span className="text-zinc-400">{new Date(a.ts).toLocaleTimeString()}</span> <span className="font-mono">{a.actor}</span> {a.action}
              {a.policyClause && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">{a.policyClause}</span>}
              <span className="text-zinc-500"> · {a.reason}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
