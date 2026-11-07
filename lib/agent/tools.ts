// The Case Officer's tools (AGENTS.md §8). Every call is timed, written to agent_runs for the activity
// feed, and — when it changes state — audited with the policy clause it relied on.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { planAllocation } from "@/lib/agent/allocation";
import { applyCodeRules, decideCase, findDuplicates, loadCaseImages, prescreenPhotos } from "@/lib/agent/evaluate";
import { assertPayable, decideStatus, GuardrailError, type AutoApproveLimits } from "@/lib/agent/guardrails";
import type { Usage } from "@/lib/agent/models";
import { POLICY } from "@/lib/agent/policy";
import { CASE_STATUSES } from "@/lib/agent/schema";
import { col, getDb } from "@/lib/db/firestore";
import { appendToolCall } from "@/lib/db/repos/agentRuns";
import { writeAudit } from "@/lib/db/repos/audit";
import { getCase, listAllCases, listCases, setCaseStatus, updateCase } from "@/lib/db/repos/cases";
import { getFund, InsufficientFundsError, releaseFunds, reserveFunds } from "@/lib/db/repos/fund";
import { createPayoutForCase, getPayout, refreshPayoutStatus } from "@/lib/db/repos/payouts";
import { fundBalanceCents, type CaseDoc } from "@/lib/db/types";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";

export interface RunContext {
  runId: string;
  trigger: string;
  limits: AutoApproveLimits;
  policyText: string;
  usage: Usage;
}

type ToolFailure = { ok: false; error: string; code?: string; clause?: string };

function failure(err: unknown): ToolFailure {
  if (err instanceof GuardrailError) return { ok: false, error: err.message, code: err.code, clause: err.clause };
  if (err instanceof InsufficientFundsError) return { ok: false, error: err.message, code: "insufficient_funds", clause: "P-9.6" };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Runs a tool body, records the call (args, result, duration) on the run, never throws into the model loop. */
async function logged<T>(ctx: RunContext, name: string, args: unknown, clause: string | undefined, fn: () => Promise<T>): Promise<T | ToolFailure> {
  const started = Date.now();
  let result: T | ToolFailure;
  let error: string | undefined;
  try {
    result = await fn();
  } catch (err) {
    result = failure(err);
    error = result.error;
  }
  try {
    await appendToolCall(ctx.runId, {
      name,
      args,
      result: truncate(result),
      policyClause: clause,
      ms: Date.now() - started,
      at: Timestamp.now(),
      ...(error ? { error } : {}),
    });
  } catch (err) {
    console.error("[tools] could not record tool call", err);
  }
  return result;
}

function truncate(value: unknown): unknown {
  const s = JSON.stringify(value);
  if (s === undefined) return null;
  return s.length > 4000 ? { truncated: s.slice(0, 4000) } : JSON.parse(s);
}

/** What the model may see of a case: everything except the applicant's contact details. */
export function caseView(c: CaseDoc) {
  return {
    id: c.id,
    status: c.status,
    lang: c.lang,
    zip: c.zip,
    householdSize: c.householdSize,
    requestedAmountCents: c.requestedAmountCents,
    narrative: c.narrative,
    photoCount: c.photos.length,
    docCount: c.docs.length,
    contact: { hasEmail: !!c.contact.email, hasPhone: !!c.contact.phone, hasAddress: !!c.contact.address },
    tier: c.tier ?? null,
    aiDecision: c.aiDecision ?? null,
    approvedAmountCents: c.approvedAmountCents ?? null,
    humanDecision: c.humanDecision
      ? { approved: c.humanDecision.approved, by: c.humanDecision.by, amountCents: c.humanDecision.amountCents ?? null, note: c.humanDecision.note ?? null }
      : null,
    redFlags: c.redFlags ?? [],
    dupMatches: c.dupMatches ?? [],
    reservedCents: c.reservedCents ?? 0,
    payoutBatchId: c.payoutBatchId ?? null,
    createdAt: c.timestamps.created.toDate().toISOString(),
  };
}

/** The amount the fund will pay for a case: the human's figure if set, else the agent's recommendation. */
export function amountForCase(c: CaseDoc): number | null {
  return c.humanDecision?.amountCents ?? c.approvedAmountCents ?? c.aiDecision?.recommendedAmountCents ?? null;
}

async function computeAndStoreDuplicates(c: CaseDoc) {
  const matches = findDuplicates(c, await listAllCases());
  await updateCase(c.id, { dupMatches: matches }, { actor: "agent", action: "case.duplicates_checked", policyClause: "P-4", reason: matches.length ? `${matches.length} match(es)` : "no matches" });
  return matches;
}

export function buildTools(ctx: RunContext): ToolSet {
  return {
    get_policy: tool({
      description: "The fund's policy text and the auto-approve limits enforced in code.",
      inputSchema: z.object({}),
      execute: async (args) =>
        logged(ctx, "get_policy", args, undefined, async () => ({
          version: POLICY.version,
          autoApprove: { limitCents: ctx.limits.limitCents, minConfidence: ctx.limits.minConfidence, minTier: ctx.limits.minTier },
          text: ctx.policyText,
        })),
    }),

    get_case: tool({
      description: "A case's application data, status, AI decision and flags. Contact details are never returned.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "get_case", args, undefined, async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          return caseView(c);
        }),
    }),

    list_cases: tool({
      description: "Cases in the given statuses, oldest first.",
      inputSchema: z.object({ statuses: z.array(z.enum(CASE_STATUSES)).min(1), limit: z.number().int().min(1).max(200).default(50) }),
      execute: async (args) =>
        logged(ctx, "list_cases", args, undefined, async () => {
          const cases = await listCases(args.statuses, args.limit);
          return cases.map((c) => ({
            id: c.id,
            status: c.status,
            tier: c.tier ?? null,
            amountCents: amountForCase(c),
            zip: c.zip,
            lang: c.lang,
            redFlags: c.redFlags ?? [],
            createdAt: c.timestamps.created.toDate().toISOString(),
          }));
        }),
    }),

    check_duplicates: tool({
      description: "Deterministic P-4 check: same photo (perceptual hash), same address, or same contact as another case.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "check_duplicates", args, "P-4", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          const matches = await computeAndStoreDuplicates(c);
          return { caseId: c.id, matches };
        }),
    }),

    evaluate_case: tool({
      description:
        "Multimodal evaluation of a case against the policy (photos + narrative). Stores the decision and moves the case to approved, parked, needs_info or needs_review. Returns the decision and the status to act on.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "evaluate_case", args, "P-9", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          if (c.aiDecision && c.status !== "new" && c.status !== "evaluating") {
            return { caseId: c.id, alreadyEvaluated: true, status: c.status, decision: c.aiDecision };
          }
          await setCaseStatus(c.id, "evaluating", { actor: "agent", action: "case.evaluating", reason: "evaluation started" });
          const dupMatches = c.dupMatches ?? (await computeAndStoreDuplicates(c));
          const images = await loadCaseImages(c);
          const prescreen = await prescreenPhotos(images, ctx.usage);

          let decision;
          try {
            decision = applyCodeRules(await decideCase({ c, images, prescreen, dupMatches, policyText: ctx.policyText, limits: ctx.limits, usage: ctx.usage }), c, dupMatches);
          } catch (err) {
            const reason = `decision could not be parsed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
            await setCaseStatus(c.id, "needs_review", { actor: "agent", action: "case.escalated", policyClause: "P-9", reason });
            return { caseId: c.id, status: "needs_review", clause: "P-9", reason, decision: null };
          }

          const amount = decision.recommendedAmountCents;
          const fund = await getFund();
          const fundsAvailable = amount !== null && fundBalanceCents(fund) >= amount;
          const next = decideStatus(decision, amount, ctx.limits, fundsAvailable);

          const patch: Partial<CaseDoc> = {
            aiDecision: decision,
            tier: decision.tier,
            redFlags: decision.redFlags,
            dupMatches,
            approvedAmountCents: amount ?? undefined,
            timestamps: { ...c.timestamps, evaluated: Timestamp.now() },
          };
          if (next.status === "needs_info") {
            const lang = normalizeLang(decision.applicantLanguage || c.lang);
            const text = [MESSAGES[lang].followUpIntro, ...decision.followUpQuestions.map((q) => `- ${q}`)].join("\n");
            patch.applicantMessage = { lang, text, at: Timestamp.now() };
          }
          await setCaseStatus(c.id, next.status, { actor: "agent", action: "case.evaluated", policyClause: next.clause, reason: next.reason }, patch);

          return {
            caseId: c.id,
            status: next.status,
            clause: next.clause,
            reason: next.reason,
            recommendedAmountCents: amount,
            decision,
            nextAction:
              next.status === "approved"
                ? "reserve_funds then create_payout"
                : next.status === "needs_info"
                  ? "request_info (the follow-up message is already drafted; calling request_info confirms it)"
                  : next.status === "needs_review"
                    ? "escalate with the reasons"
                    : "note that the case waits for funds",
          };
        }),
    }),

    get_fund_balance: tool({
      description: "Fund totals in cents: raised, paid, reserved and the available balance.",
      inputSchema: z.object({}),
      execute: async (args) =>
        logged(ctx, "get_fund_balance", args, undefined, async () => {
          const f = await getFund();
          return { currency: f.currency, raisedCents: f.raisedCents, paidCents: f.paidCents, reservedCents: f.reservedCents, balanceCents: fundBalanceCents(f) };
        }),
    }),

    reserve_funds: tool({
      description: "Reserves the case's amount from the fund balance before a payout (P-9.6). If the balance is short the case is parked instead.",
      inputSchema: z.object({ caseId: z.string(), amountCents: z.number().int().positive().optional() }),
      execute: async (args) =>
        logged(ctx, "reserve_funds", args, "P-9.6", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          const amount = args.amountCents ?? amountForCase(c);
          if (amount === null) throw new Error("no amount to reserve: evaluate the case first");
          try {
            const r = await reserveFunds(c.id, amount, { actor: "agent", policyClause: "P-9.6", reason: `reserve ${amount} for ${c.id}` });
            return { ok: true, caseId: c.id, reservedCents: amount, balanceAfterCents: r.balanceAfterCents };
          } catch (err) {
            if (err instanceof InsufficientFundsError) {
              if (c.status !== "parked") {
                await setCaseStatus(c.id, "parked", { actor: "agent", action: "case.parked", policyClause: "P-8", reason: err.message });
              }
              return { ok: false, parked: true, caseId: c.id, neededCents: err.neededCents, availableCents: err.availableCents, clause: "P-8" };
            }
            throw err;
          }
        }),
    }),

    release_funds: tool({
      description: "Releases a case's reservation back to the fund (for example after a failed payout).",
      inputSchema: z.object({ caseId: z.string(), reason: z.string() }),
      execute: async (args) =>
        logged(ctx, "release_funds", args, "P-9.6", async () => {
          const r = await releaseFunds(args.caseId, { actor: "agent", policyClause: "P-9.6", reason: args.reason });
          return { ok: true, ...r };
        }),
    }),

    create_payout: tool({
      description:
        "Pays the case through PayPal Payouts. Refuses unless a human approved it or every P-9 auto-approve condition holds; never a second payout; never overdraws.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "create_payout", args, "P-9", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          const amount = amountForCase(c);
          if (amount === null) throw new GuardrailError("bad_amount", "no amount on file for this case", "P-7");
          const [fund, existing] = await Promise.all([getFund(), getPayout(c.id)]);
          const { path } = assertPayable({
            caseStatus: c.status,
            aiDecision: c.aiDecision,
            humanApproved: !!c.humanDecision?.approved,
            amountCents: amount,
            fundBalanceCents: fundBalanceCents(fund),
            caseReservedCents: c.reservedCents ?? 0,
            existingPayout: !!existing,
            limits: ctx.limits,
          });
          if ((c.reservedCents ?? 0) !== amount) {
            await reserveFunds(c.id, amount, { actor: "agent", policyClause: "P-9.6", reason: `reserve ${amount} before payout` });
          }
          if (c.status !== "approved") {
            await setCaseStatus(c.id, "approved", {
              actor: "agent",
              action: "case.approved",
              policyClause: path === "auto" ? "P-9" : "human decision",
              reason: path === "auto" ? "all auto-approve conditions hold" : `approved by ${c.humanDecision?.by}`,
            });
          }
          const payout = await createPayoutForCase({
            caseId: c.id,
            amountCents: amount,
            currency: fund.currency,
            recipientEmail: c.contact.email,
            note: `Relief grant from ${fund.name}. Reference ${c.id}.`,
            actor: "agent",
            policyClause: path === "auto" ? "P-9" : "human decision",
            reason: path === "auto" ? "auto-approved payout" : "human-approved payout",
          });
          return { ok: true, caseId: c.id, path, amountCents: amount, payoutBatchId: payout.payoutBatchId ?? null, batchStatus: payout.status };
        }),
    }),

    get_payout_status: tool({
      description: "Polls PayPal for the case's payout batch and applies the item status (paid / failed / pending).",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "get_payout_status", args, undefined, async () => {
          const r = await refreshPayoutStatus(args.caseId);
          return {
            caseId: args.caseId,
            payout: r.payout ? { status: r.payout.status, outcome: r.payout.outcome, payoutBatchId: r.payout.payoutBatchId ?? null, amountCents: r.payout.amountCents, error: r.payout.error ?? null } : null,
            applied: r.applied,
          };
        }),
    }),

    request_info: tool({
      description: "Asks the applicant for what the policy needs (P-5), in their language, and sets the case to needs_info.",
      inputSchema: z.object({ caseId: z.string(), questions: z.array(z.string().min(1)).min(1), lang: z.enum(["en", "es"]) }),
      execute: async (args) =>
        logged(ctx, "request_info", args, "P-5", async () => {
          const text = [MESSAGES[args.lang].followUpIntro, ...args.questions.map((q) => `- ${q}`)].join("\n");
          await setCaseStatus(
            args.caseId,
            "needs_info",
            { actor: "agent", action: "case.request_info", policyClause: "P-5", reason: `${args.questions.length} question(s) sent in ${args.lang}` },
            { applicantMessage: { lang: args.lang, text, at: Timestamp.now() } },
          );
          return { ok: true, caseId: args.caseId, status: "needs_info", questions: args.questions.length };
        }),
    }),

    escalate: tool({
      description: "Hands the case to a human (needs_review) with the agent's reasons. The agent never rejects.",
      inputSchema: z.object({ caseId: z.string(), reasons: z.array(z.string().min(1)).min(1), clause: z.string().regex(/^P-\d+(\.\d+)?$/) }),
      execute: async (args) =>
        logged(ctx, "escalate", args, args.clause, async () => {
          await setCaseStatus(args.caseId, "needs_review", { actor: "agent", action: "case.escalated", policyClause: args.clause, reason: args.reasons.join("; ") });
          return { ok: true, caseId: args.caseId, status: "needs_review" };
        }),
    }),

    note: tool({
      description: "Leaves a short note on a case (or on the run when no case is given). No personal data.",
      inputSchema: z.object({ caseId: z.string().optional(), text: z.string().min(1).max(500) }),
      execute: async (args) =>
        logged(ctx, "note", args, undefined, async () => {
          if (args.caseId) {
            await getDb()
              .collection(col.cases)
              .doc(args.caseId)
              .update({ notes: FieldValue.arrayUnion({ by: "agent", text: args.text, at: Timestamp.now() }) });
          }
          await writeAudit({ actor: "agent", caseId: args.caseId, action: "note", reason: args.text });
          return { ok: true };
        }),
    }),

    plan_allocation: tool({
      description: "P-8 allocation of the available balance over the cases waiting for money (approved or parked): which to pay now, in order, and which stay parked.",
      inputSchema: z.object({}),
      execute: async (args) =>
        logged(ctx, "plan_allocation", args, "P-8", async () => {
          const [fund, waiting] = await Promise.all([getFund(), listCases(["approved", "parked"])]);
          const candidates = waiting
            .map((c) => ({ c, amountCents: amountForCase(c) }))
            .filter((x): x is { c: CaseDoc; amountCents: number } => x.amountCents !== null)
            .map((x) => ({ id: x.c.id, tier: x.c.tier ?? x.c.aiDecision?.tier ?? 0, amountCents: x.amountCents, createdAtMs: x.c.timestamps.created.toMillis(), status: x.c.status }));
          // Already-reserved amounts are available to their own case: count them back into the balance.
          const reservedByWaiting = waiting.reduce((sum, c) => sum + (c.reservedCents ?? 0), 0);
          const plan = planAllocation(candidates, fundBalanceCents(fund) + reservedByWaiting);
          return { balanceCents: fundBalanceCents(fund), pay: plan.pay, park: plan.park, remainingCents: plan.remainingCents };
        }),
    }),
  };
}
