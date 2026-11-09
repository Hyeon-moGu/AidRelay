// Human decisions from the operator console. Every one goes through the same state machine as the agent
// (actor `human:ops`), is audited, and keeps the fund's reservations consistent.
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { GuardrailError, limitsFromEnv } from "@/lib/agent/guardrails";
import { amountForCase } from "@/lib/agent/tools";
import { assertTransition } from "@/lib/agent/transitions";
import { enqueueAgentRun } from "@/lib/agent/trigger";
import { getCase, setCaseStatus } from "@/lib/db/repos/cases";
import { releaseFunds } from "@/lib/db/repos/fund";
import type { CaseDoc } from "@/lib/db/types";
import { getEnv } from "@/lib/env";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { scrubPii } from "@/lib/ledger/anonymize";
import { OPS_ACTOR } from "@/lib/ops/auth";

export const DecisionRequestSchema = z.object({
  action: z.enum(["approve", "reject", "request_info", "reopen"]),
  caseIds: z.array(z.string().min(1)).min(1).max(100),
  /** approve: amount in cents; omitted = the agent's recommendation / the grid's edited value per case. */
  amountCents: z.number().int().positive().optional(),
  /** approve: per-case amounts from inline edits (cents). */
  amounts: z.record(z.string(), z.number().int().positive()).optional(),
  note: z.string().max(500).optional(),
  /** request_info */
  questions: z.array(z.string().min(1).max(500)).max(10).optional(),
  lang: z.enum(["en", "es"]).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/**
 * Reopening a case or asking the applicant a question takes back the volunteer's earlier decision. Left on
 * the case, an old approval would still count as "a human approved it": the agent could then neither
 * re-evaluate the case (the state machine protects human approvals) nor be stopped from paying it once parked.
 */
const WITHDRAW_DECISION = { clear: ["humanDecision"] } as const;

export interface DecisionOutcome {
  caseId: string;
  ok: boolean;
  status?: string;
  amountCents?: number;
  error?: string;
}

export async function applyHumanDecision(req: DecisionRequest): Promise<{ results: DecisionOutcome[]; agentTriggered: boolean }> {
  const limits = limitsFromEnv(getEnv());
  const results: DecisionOutcome[] = [];
  let approved = 0;

  for (const caseId of req.caseIds) {
    try {
      const c = await getCase(caseId);
      if (!c) throw new Error("case not found");
      switch (req.action) {
        case "approve": {
          const amountCents = req.amounts?.[caseId] ?? req.amountCents ?? amountForCase(c);
          if (amountCents === null || amountCents === undefined) throw new Error("no amount on file; enter one");
          if (amountCents > limits.humanMaxCents) {
            throw new GuardrailError("over_human_cap", `${amountCents} exceeds the human ceiling ${limits.humanMaxCents} (P-7)`, "P-7");
          }
          const humanDecision = { approved: true, by: OPS_ACTOR, amountCents, note: req.note ? scrubPii(req.note) : undefined, at: Timestamp.now() };
          const updated = await setCaseStatus(
            caseId,
            "approved",
            { actor: OPS_ACTOR, action: "case.human_approved", policyClause: "human decision", reason: req.note ? scrubPii(req.note) : `approved by operator for ${amountCents} cents` },
            { humanDecision, approvedAmountCents: amountCents },
          );
          approved++;
          results.push({ caseId, ok: true, status: updated.status, amountCents });
          break;
        }
        case "reject": {
          // Checked before the reservation is touched: a refused decision must leave the money where it was.
          assertTransition(OPS_ACTOR, c.status, "rejected");
          await releaseIfReserved(c);
          const humanDecision = { approved: false, by: OPS_ACTOR, note: req.note ? scrubPii(req.note) : undefined, at: Timestamp.now() };
          const updated = await setCaseStatus(
            caseId,
            "rejected",
            { actor: OPS_ACTOR, action: "case.human_rejected", policyClause: "human decision", reason: req.note ? scrubPii(req.note) : "rejected by operator" },
            { humanDecision },
          );
          results.push({ caseId, ok: true, status: updated.status });
          break;
        }
        case "request_info": {
          const lang = req.lang ?? normalizeLang(c.lang);
          const questions = (req.questions ?? []).map((q) => scrubPii(q.trim())).filter(Boolean);
          if (questions.length === 0) throw new Error("write at least one question");
          assertTransition(OPS_ACTOR, c.status, "needs_info");
          await releaseIfReserved(c);
          const text = [MESSAGES[lang].followUpIntro, ...questions.map((q) => `- ${q}`)].join("\n");
          const updated = await setCaseStatus(
            caseId,
            "needs_info",
            { actor: OPS_ACTOR, action: "case.human_request_info", policyClause: "P-5", reason: `${questions.length} question(s) by operator` },
            { applicantMessage: { lang, text, at: Timestamp.now() } },
            WITHDRAW_DECISION,
          );
          results.push({ caseId, ok: true, status: updated.status });
          break;
        }
        case "reopen": {
          assertTransition(OPS_ACTOR, c.status, "needs_review");
          await releaseIfReserved(c);
          const updated = await setCaseStatus(
            caseId,
            "needs_review",
            { actor: OPS_ACTOR, action: "case.human_reopened", reason: req.note ? scrubPii(req.note) : "reopened by operator" },
            {},
            WITHDRAW_DECISION,
          );
          results.push({ caseId, ok: true, status: updated.status });
          break;
        }
      }
    } catch (err) {
      results.push({ caseId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Approved cases are paid by the agent (reserve → create_payout, P-8 order), never directly by the console.
  if (approved > 0) enqueueAgentRun({ trigger: "operator.command", command: `An operator approved ${approved} case(s)` });
  return { results, agentTriggered: approved > 0 };
}

async function releaseIfReserved(c: CaseDoc): Promise<void> {
  if ((c.reservedCents ?? 0) > 0 && c.status !== "paying" && c.status !== "paid") {
    await releaseFunds(c.id, { actor: OPS_ACTOR, policyClause: "P-9.6", reason: "operator decision" });
  }
}
