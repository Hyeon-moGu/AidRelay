// The Case Officer's tools. Every call is timed, written to agent_runs for the activity
// feed, and, when it changes state, audited with the policy clause it relied on.
// The model never chooses an amount: amounts come from the policy (tier + P-6) or from a human.
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { APICallError, NoObjectGeneratedError, tool, type ToolSet } from "ai";
import { z } from "zod";
import { planAllocation, wouldBePaid, type AllocationCase } from "@/lib/agent/allocation";
import { applyCodeRules, countUsableEvidence, decideCase, findDuplicates, loadCaseImages, prescreenPhotos } from "@/lib/agent/evaluate";
import { assertPayable, autoApproveCheck, decideStatus, GuardrailError, velocityCheck, type AutoApproveLimits } from "@/lib/agent/guardrails";
import type { Usage } from "@/lib/agent/models";
import { POLICY } from "@/lib/agent/policy";
import { stripDelimiters } from "@/lib/agent/prompts";
import { CASE_STATUSES, type Decision } from "@/lib/agent/schema";
import { col, getDb } from "@/lib/db/firestore";
import { appendToolCall } from "@/lib/db/repos/agentRuns";
import { writeAudit } from "@/lib/db/repos/audit";
import { recentAutoPayouts } from "@/lib/db/repos/autoApprovals";
import { claimForEvaluation, getCase, listAllCases, listCases, setCaseStatus, updateCase } from "@/lib/db/repos/cases";
import { getFund, InsufficientFundsError, releaseFunds, reserveFunds } from "@/lib/db/repos/fund";
import { createPayoutForCase, getPayout, refreshPayoutStatus } from "@/lib/db/repos/payouts";
import { amountForCase, fundBalanceCents, type CaseDoc } from "@/lib/db/types";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { scrubIdentity, scrubPii } from "@/lib/ledger/anonymize";
import { payoutNote } from "@/lib/paypal/payouts";

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

/**
 * What the orchestrator may see of a case: no contact details, and only a short, delimited, scrubbed
 * excerpt of the narrative (the full text goes to the decision call, wrapped as untrusted data).
 */
export function caseView(c: CaseDoc) {
  // No name or street address either: what the orchestrator reads can end up in a run summary a visitor sees.
  const excerpt = scrubIdentity(scrubPii(stripDelimiters(c.narrative)), c.contact).slice(0, 200);
  return {
    id: c.id,
    status: c.status,
    lang: c.lang,
    zip: c.zip,
    householdSize: c.householdSize,
    requestedAmountCents: c.requestedAmountCents,
    narrativeExcerpt: `<applicant_narrative>${excerpt}</applicant_narrative>`,
    photoCount: c.photos.length,
    docCount: c.docs.length,
    usableEvidenceCount: c.usableEvidenceCount ?? null,
    contact: { hasEmail: !!c.contact.email, hasPhone: !!c.contact.phone, hasAddress: !!c.contact.address },
    tier: c.tier ?? null,
    aiDecision: c.aiDecision ?? null,
    secondEvaluationAgrees: c.secondEvaluationAgrees ?? null,
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

export { amountForCase };

async function computeAndStoreDuplicates(c: CaseDoc) {
  const matches = findDuplicates(c, await listAllCases());
  await updateCase(c.id, { dupMatches: matches }, { actor: "agent", action: "case.duplicates_checked", policyClause: "P-4", reason: matches.length ? `${matches.length} match(es)` : "no matches" });
  return matches;
}

/** Before the agent hands a reserved case to a human, the reservation goes back to the balance. */
async function releaseIfReserved(c: CaseDoc, reason: string): Promise<void> {
  if ((c.reservedCents ?? 0) > 0 && c.status !== "paying" && c.status !== "paid") {
    await releaseFunds(c.id, { actor: "agent", policyClause: "P-9.6", reason });
  }
}

/** P-10: an agent-approved case past the automation limit waits for a human; its reservation goes back first. */
async function handOverAtLimit(c: CaseDoc, err: GuardrailError): Promise<void> {
  if (c.status !== "approved" && c.status !== "parked") return;
  await releaseIfReserved(c, "automation limit reached (P-10)");
  await setCaseStatus(c.id, "needs_review", { actor: "agent", action: "case.escalated", policyClause: "P-10", reason: err.message });
}

const inPayment = (c: Pick<CaseDoc, "status">): boolean => c.status === "paying" || c.status === "paid";

/**
 * Two runs can work on the same waiting cases at once (a volunteer's approval and a donation, or a sweep).
 * The payout claim lets exactly one of them pay a case; for the other this is not an error, just nothing
 * left to do, and the activity feed should say so instead of showing a refusal.
 */
function alreadyInPayment(c: CaseDoc) {
  return { ok: true, caseId: c.id, alreadyHandled: true, status: c.status, payoutBatchId: c.payoutBatchId ?? null, note: "another run is already paying this case; nothing to do" };
}

export function buildTools(ctx: RunContext): ToolSet {
  return {
    get_policy: tool({
      description: "The fund's policy text and the limits enforced in code (auto-approve, human ceiling, automation limits).",
      inputSchema: z.object({}),
      execute: async (args) =>
        logged(ctx, "get_policy", args, undefined, async () => ({
          version: POLICY.version,
          limits: ctx.limits,
          text: ctx.policyText,
        })),
    }),

    get_case: tool({
      description: "A case's application data, status, AI decision and flags. Contact details are never returned; the narrative is a short excerpt.",
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
      description: "Deterministic P-4 check: same photo (perceptual hash), same address, or same contact as an earlier case.",
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
          const before = await getCase(args.caseId);
          if (!before) throw new Error(`case ${args.caseId} not found`);
          if (before.aiDecision && before.status !== "new" && before.status !== "evaluating") {
            return { caseId: before.id, alreadyEvaluated: true, status: before.status, decision: before.aiDecision };
          }
          const claim = await claimForEvaluation(before.id);
          if (claim === "busy") return { caseId: before.id, busy: true, status: "evaluating", note: "another run holds the evaluation lock; do nothing" };
          if (claim === "not_claimable") return { caseId: before.id, status: before.status, note: "not a new case; nothing to evaluate" };
          const c = (await getCase(before.id)) as CaseDoc;

          try {
            const dupMatches = c.dupMatches ?? (await computeAndStoreDuplicates(c));
            const images = await loadCaseImages(c);
            const prescreen = await prescreenPhotos(images, ctx.usage);
            const usableEvidence = countUsableEvidence(images, prescreen);
            const evidenceInfo = { usable: usableEvidence, descriptions: prescreen?.map((p) => p.description) };
            const decideArgs = { c, images, prescreen, dupMatches, policyText: ctx.policyText, limits: ctx.limits, usage: ctx.usage };

            let decision: Decision;
            try {
              decision = applyCodeRules(await decideCase(decideArgs), c, dupMatches, evidenceInfo);
            } catch (err) {
              if (err instanceof APICallError) throw err; // transport / rate limit: handled below, not a verdict
              const reason = `decision could not be parsed: ${err instanceof NoObjectGeneratedError ? "model output did not match the schema" : err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
              await setCaseStatus(c.id, "needs_review", { actor: "agent", action: "case.escalated", policyClause: "P-9", reason }, { usableEvidenceCount: usableEvidence });
              return { caseId: c.id, status: "needs_review", clause: "P-9", reason, decision: null };
            }

            const amount = decision.recommendedAmountCents;
            // P-8 applies to a new case too: it is paid now only if the plan would pay it once it joins the
            // cases already waiting. With nobody waiting this is simply "the balance covers the amount".
            const queue = await loadWaitingQueue();
            const fundsAvailable =
              amount !== null &&
              wouldBePaid({ id: c.id, tier: decision.tier ?? 0, amountCents: amount, createdAtMs: c.timestamps.created.toMillis() }, queue.candidates, queue.queueBalanceCents);
            const velocity = amount === null ? { ok: true as const } : velocityCheck(await recentAutoPayouts(), amount, Date.now(), ctx.limits.velocity);
            const decideCtx = { fundsAvailable, usableEvidence, velocityOk: velocity.ok, applicantAnswered: (c.applicantReplies ?? 0) > 0 };
            let next = decideStatus(decision, amount, ctx.limits, decideCtx);

            // P-9.9: anything the agent could pay on its own, now (approved) or after a donation (parked).
            // needs a second, independent evaluation that agrees on eligibility and tier.
            let second: Decision | undefined;
            let secondAgrees: boolean | undefined;
            const autoCandidate = amount !== null && autoApproveCheck(decision, amount, ctx.limits, usableEvidence).ok;
            if (autoCandidate && ctx.limits.requireSecondEvaluation) {
              second = applyCodeRules(await decideCase({ ...decideArgs, secondOpinion: true }), c, dupMatches, evidenceInfo);
              secondAgrees = second.eligibility === decision.eligibility && second.tier === decision.tier;
              if (!secondAgrees) {
                next = {
                  status: "needs_review",
                  clause: "P-9.9",
                  reason: `the two evaluations disagree: ${decision.eligibility}/tier ${decision.tier} vs ${second.eligibility}/tier ${second.tier}`,
                };
              } else {
                // Agreement on the verdict is not enough: a red flag either evaluation raised stands (P-9.5).
                decision = {
                  ...decision,
                  confidence: Math.min(decision.confidence, second.confidence),
                  redFlags: [...new Set([...decision.redFlags, ...second.redFlags])],
                };
                next = decideStatus(decision, amount, ctx.limits, decideCtx);
              }
            }

            const patch: Partial<CaseDoc> = {
              aiDecision: decision,
              aiDecisionSecond: second,
              secondEvaluationAgrees: secondAgrees,
              tier: decision.tier,
              redFlags: decision.redFlags,
              dupMatches,
              usableEvidenceCount: usableEvidence,
              approvedAmountCents: amount ?? undefined,
              timestamps: { ...c.timestamps, evaluated: Timestamp.now() },
            };
            if (next.status === "needs_info") {
              const lang = normalizeLang(decision.applicantLanguage || c.lang);
              const text = [MESSAGES[lang].followUpIntro, ...decision.followUpQuestions.map((q) => `- ${scrubPii(q)}`)].join("\n");
              patch.applicantMessage = { lang, text, at: Timestamp.now() };
            }
            // What this evaluation did not produce is removed, not left from an earlier one: an old amount would
            // otherwise still count as the agent's recommendation for a volunteer's one-click approval.
            const clear = [
              ...(amount === null ? (["approvedAmountCents"] as const) : []),
              ...(second === undefined ? (["aiDecisionSecond", "secondEvaluationAgrees"] as const) : []),
            ];
            await setCaseStatus(c.id, next.status, { actor: "agent", action: "case.evaluated", policyClause: next.clause, reason: next.reason }, patch, { clear });

            return {
              caseId: c.id,
              status: next.status,
              clause: next.clause,
              reason: next.reason,
              recommendedAmountCents: amount,
              usableEvidence,
              secondEvaluation: second ? { eligibility: second.eligibility, tier: second.tier, confidence: second.confidence, agrees: secondAgrees } : null,
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
          } catch (err) {
            // Transient or unexpected failure: hand the case back to `new` so the sweep retries, and surface the error.
            await setCaseStatus(c.id, "new", {
              actor: "system",
              action: "case.evaluation_aborted",
              reason: `retry later: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
            }).catch((e) => console.error("[evaluate_case] could not hand the case back", e));
            throw err;
          }
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
      description: "Reserves the case's policy amount from the fund balance before a payout (P-9.6). Only approved or parked cases; if the balance is short the case is parked.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "reserve_funds", args, "P-9.6", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          if (inPayment(c)) return alreadyInPayment(c);
          const amount = amountForCase(c);
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
            // Another run started paying the case between the read above and the reservation.
            const latest = await getCase(c.id);
            if (latest && inPayment(latest)) return alreadyInPayment(latest);
            throw err;
          }
        }),
    }),

    create_payout: tool({
      description:
        "Pays the case through PayPal Payouts. Refuses unless a human approved it (within the P-7 ceiling) or every P-9 auto-approve condition holds (evidence, agreeing second evaluation, P-10 limits); never a second payout; never overdraws.",
      inputSchema: z.object({ caseId: z.string() }),
      execute: async (args) =>
        logged(ctx, "create_payout", args, "P-9", async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          if (inPayment(c)) return alreadyInPayment(c);
          const amount = amountForCase(c);
          if (amount === null) throw new GuardrailError("bad_amount", "no amount on file for this case", "P-7");
          const [fund, existing, recent] = await Promise.all([getFund(), getPayout(c.id), recentAutoPayouts()]);
          const humanApproved = !!c.humanDecision?.approved;

          let path: "human" | "auto";
          try {
            path = assertPayable({
              caseStatus: c.status,
              aiDecision: c.aiDecision,
              humanApproved,
              amountCents: amount,
              fundBalanceCents: fundBalanceCents(fund),
              caseReservedCents: c.reservedCents ?? 0,
              existingPayout: !!existing,
              usableEvidenceCount: c.usableEvidenceCount,
              secondEvaluationAgrees: c.secondEvaluationAgrees,
              recentAutoPayouts: recent,
              nowMs: Date.now(),
              limits: ctx.limits,
            }).path;
          } catch (err) {
            if (err instanceof GuardrailError && err.code === "velocity_limit" && !humanApproved) await handOverAtLimit(c, err);
            throw err;
          }

          // P-8 in code: the case is paid now only if the plan over every waiting case would pay it, so a call
          // out of order cannot take money a family ahead of it in the queue still needs.
          const queue = await loadWaitingQueue();
          const candidate = { id: c.id, tier: c.tier ?? c.aiDecision?.tier ?? 0, amountCents: amount, createdAtMs: c.timestamps.created.toMillis() };
          if (!wouldBePaid(candidate, queue.candidates, queue.queueBalanceCents)) {
            // Another run may have started paying this very case since it was read (it then left the queue,
            // reservation and all): that is not a refusal, just nothing left to do.
            const latest = await getCase(c.id);
            if (latest && inPayment(latest)) return alreadyInPayment(latest);
            if (latest?.status === "approved" || latest?.status === "parked") {
              // A parked case gives its reservation back: held, it would keep the case ahead of it from reserving.
              try {
                await releaseIfReserved(latest, "parked: a case ahead of it in the P-8 order needs the balance");
              } catch (err) {
                const again = await getCase(c.id);
                if (again && inPayment(again)) return alreadyInPayment(again);
                throw err;
              }
              if (latest.status === "approved") {
                await setCaseStatus(c.id, "parked", { actor: "agent", action: "case.parked", policyClause: "P-8", reason: "a case ahead of it in the P-8 order still needs the balance" }).catch(async (err) => {
                  const again = await getCase(c.id);
                  if (!(again && inPayment(again))) throw err;
                });
              }
            }
            const now = await getCase(c.id);
            if (now && inPayment(now)) return alreadyInPayment(now);
            return { ok: false, parked: true, caseId: c.id, clause: "P-8", note: "a case ahead of this one in the P-8 order still needs the balance; call plan_allocation and pay in its order" };
          }

          try {
            if ((c.reservedCents ?? 0) !== amount) {
              if (c.status !== "approved" && c.status !== "parked") {
                await setCaseStatus(c.id, "approved", {
                  actor: "agent",
                  action: "case.approved",
                  policyClause: path === "auto" ? "P-9" : "human decision",
                  reason: path === "auto" ? "all auto-approve conditions hold" : `approved by ${c.humanDecision?.by}`,
                });
              }
              await reserveFunds(c.id, amount, { actor: "agent", policyClause: "P-9.6", reason: `reserve ${amount} before payout` });
            }
            const now = await getCase(c.id);
            if (now && inPayment(now)) return alreadyInPayment(now);
            if (now?.status !== "approved") {
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
              note: payoutNote(fund.name, c.id),
              actor: "agent",
              policyClause: path === "auto" ? "P-9" : "human decision",
              reason: path === "auto" ? "auto-approved payout" : "human-approved payout",
              autoApproved: path === "auto",
              velocity: path === "auto" ? ctx.limits.velocity : undefined,
            });
            return { ok: true, caseId: c.id, path, amountCents: amount, payoutBatchId: payout.payoutBatchId ?? null, batchStatus: payout.batchStatus ?? payout.status };
          } catch (err) {
            // Lost the claim to another run that is paying the same case right now: nothing was refused and
            // nothing is left to do. A payout PayPal did not accept leaves the case `approved`, so it still
            // surfaces as the error it is.
            const latest = await getCase(c.id);
            if (latest && inPayment(latest)) return alreadyInPayment(latest);
            // The P-10 check inside the claim found the limit reached by a payout made in the meantime.
            if (latest && err instanceof GuardrailError && err.code === "velocity_limit" && path === "auto") await handOverAtLimit(latest, err);
            throw err;
          }
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
          const questions = args.questions.map((q) => scrubPii(q.trim())).filter(Boolean);
          const text = [MESSAGES[args.lang].followUpIntro, ...questions.map((q) => `- ${q}`)].join("\n");
          await setCaseStatus(
            args.caseId,
            "needs_info",
            { actor: "agent", action: "case.request_info", policyClause: "P-5", reason: `${questions.length} question(s) sent in ${args.lang}` },
            { applicantMessage: { lang: args.lang, text, at: Timestamp.now() } },
          );
          return { ok: true, caseId: args.caseId, status: "needs_info", questions: questions.length };
        }),
    }),

    escalate: tool({
      description: "Hands the case to a human (needs_review) with the agent's reasons, releasing any reservation. The agent never rejects.",
      inputSchema: z.object({ caseId: z.string(), reasons: z.array(z.string().min(1)).min(1), clause: z.string().regex(/^P-\d+(\.\d+)?$/) }),
      execute: async (args) =>
        logged(ctx, "escalate", args, args.clause, async () => {
          const c = await getCase(args.caseId);
          if (!c) throw new Error(`case ${args.caseId} not found`);
          // "...cannot pay." + "; " would read ".;": each reason loses its own closing punctuation first.
          const reason = scrubPii(args.reasons.map((r) => r.trim().replace(/[.;\s]+$/, "")).join("; ")).slice(0, 1000);
          await releaseIfReserved(c, `escalated: ${reason.slice(0, 120)}`);
          await setCaseStatus(args.caseId, "needs_review", { actor: "agent", action: "case.escalated", policyClause: args.clause, reason });
          return { ok: true, caseId: args.caseId, status: "needs_review" };
        }),
    }),

    note: tool({
      description: "Leaves a short note on a case (or on the run when no case is given). No personal data.",
      inputSchema: z.object({ caseId: z.string().optional(), text: z.string().min(1).max(500) }),
      execute: async (args) =>
        logged(ctx, "note", args, undefined, async () => {
          const text = scrubPii(args.text);
          if (args.caseId) {
            await getDb()
              .collection(col.cases)
              .doc(args.caseId)
              .update({ notes: FieldValue.arrayUnion({ by: "agent", text, at: Timestamp.now() }) });
          }
          await writeAudit({ actor: "agent", caseId: args.caseId, action: "note", reason: text });
          return { ok: true };
        }),
    }),

    plan_allocation: tool({
      description:
        "P-8 allocation of the available balance over the cases waiting for money (approved or parked): which to pay now, in order. Approved cases the balance cannot cover are moved to parked here, in code; they are paid on a later donation. Cases listed under blocked already have a payout record and wait for an operator.",
      inputSchema: z.object({}),
      execute: async (args) => logged(ctx, "plan_allocation", args, "P-8", () => planWaitingCases()),
    }),
  };
}

type PlannedCase = AllocationCase & { status: CaseDoc["status"] };

export interface WaitingPlan {
  balanceCents: number;
  /** Payable now, in P-8 order. */
  pay: PlannedCase[];
  /** The balance cannot cover these; they wait as `parked`. */
  park: PlannedCase[];
  /** Approved cases this call moved to `parked`. */
  parkedNow: string[];
  /** A payout record already exists (PayPal did not accept it, or it failed): only an operator can move these. */
  blocked: Array<{ id: string; payoutStatus: string }>;
  remainingCents: number;
}

/** The cases waiting for money as P-8 sees them, and the balance they share. */
async function loadWaitingQueue(): Promise<{ fundBalanceCents: number; queueBalanceCents: number; candidates: PlannedCase[]; blocked: WaitingPlan["blocked"] }> {
  const [fund, waiting] = await Promise.all([getFund(), listCases(["approved", "parked"])]);
  const payouts = await Promise.all(waiting.map((c) => getPayout(c.id)));
  // One payout per case (§1.3): a case that already has a payout record cannot be paid again by the agent,
  // so it takes no place in the plan. Its reservation, if it has one, stays set aside for it.
  const blocked: WaitingPlan["blocked"] = [];
  const open: CaseDoc[] = [];
  waiting.forEach((c, i) => {
    const payout = payouts[i];
    if (payout) blocked.push({ id: c.id, payoutStatus: payout.status });
    else open.push(c);
  });
  const candidates = open
    .map((c) => ({ c, amountCents: amountForCase(c) }))
    .filter((x): x is { c: CaseDoc; amountCents: number } => x.amountCents !== null)
    .map((x) => ({ id: x.c.id, tier: x.c.tier ?? x.c.aiDecision?.tier ?? 0, amountCents: x.amountCents, createdAtMs: x.c.timestamps.created.toMillis(), status: x.c.status }));
  // Already-reserved amounts are available to their own case: count them back into the balance.
  const reservedByOpen = open.reduce((sum, c) => sum + (c.reservedCents ?? 0), 0);
  const balance = fundBalanceCents(fund);
  return { fundBalanceCents: balance, queueBalanceCents: balance + reservedByOpen, candidates, blocked };
}

/**
 * P-8 over every case waiting for money, in code: what to pay now and in which order, and which approved
 * cases to park. The plan_allocation tool and the sweep both use it, so the sweep can tell without a model
 * call whether there is anything to pay.
 */
export async function planWaitingCases(): Promise<WaitingPlan> {
  const queue = await loadWaitingQueue();
  const { blocked } = queue;
  const plan = planAllocation(queue.candidates, queue.queueBalanceCents);
  // P-8: a case the money cannot cover waits as `parked`, so the queue and the public ledger show it as
  // waiting for funds (a human-approved case may be parked; it stays approved by its human).
  const parkedNow: string[] = [];
  for (const p of plan.park) {
    // A case the money cannot reach gives its reservation back, so the cases ahead of it can reserve.
    const held = await getCase(p.id);
    if (held && (held.reservedCents ?? 0) > 0) {
      await releaseIfReserved(held, `parked: the balance does not reach it in P-8 order`).catch((err) =>
        console.warn(`[tools] could not release ${p.id}:`, err instanceof Error ? err.message : err),
      );
    }
    if (p.status !== "approved") continue;
    try {
      await setCaseStatus(p.id, "parked", {
        actor: "agent",
        action: "case.parked",
        policyClause: "P-8",
        reason: `insufficient funds: need ${p.amountCents}, available ${plan.remainingCents}`,
      });
      parkedNow.push(p.id);
    } catch (err) {
      console.warn(`[tools] could not park ${p.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { balanceCents: queue.fundBalanceCents, pay: plan.pay, park: plan.park, parkedNow, blocked, remainingCents: plan.remainingCents };
}
