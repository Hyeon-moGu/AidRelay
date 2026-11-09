// runCaseOfficer(trigger): the event-driven agent.
// Model sessions for case evaluation and allocation; payout webhooks are reconciled in code.
// A run is recorded (agent_runs, the /ops activity feed) when it did something: a sweep that found nothing
// and a payout update that changed nothing leave no run behind, so a scheduled sweep costs no model call
// and adds no noise to the feed. Every webhook is still kept in webhook_events and on its payout record.
import { generateText, stepCountIs } from "ai";
import { Timestamp } from "firebase-admin/firestore";
import { limitsFromEnv } from "@/lib/agent/guardrails";
import { addUsage, newUsage, officerModel, type Usage } from "@/lib/agent/models";
import { loadPolicyText } from "@/lib/agent/policy";
import { allocationPrompt, caseCreatedPrompt, OFFICER_SYSTEM, policySystemMessage } from "@/lib/agent/prompts";
import { buildTools, planWaitingCases, type RunContext } from "@/lib/agent/tools";
import type { AgentRunRequest } from "@/lib/agent/trigger";
import { appendToolCall, finishRun, startRun } from "@/lib/db/repos/agentRuns";
import { listCases, resetStaleEvaluating } from "@/lib/db/repos/cases";
import { applyPayoutEvent, refreshPayoutStatus } from "@/lib/db/repos/payouts";
import { getWebhookEvent } from "@/lib/db/repos/webhookEvents";
import { getEnv } from "@/lib/env";
import { WebhookEventSchema } from "@/lib/paypal/events";
import { parsePayoutEvent } from "@/lib/paypal/payouts";

const MAX_STEPS_CASE = 16;
const MAX_STEPS_ALLOCATION = 48;
const MAX_NEW_CASES_PER_SWEEP = 25;
/** A `paying` case older than this is polled on every sweep in case its webhook never arrived. */
const PAYING_POLL_AFTER_MS = 2 * 60_000;

export interface RunResult {
  /** Absent when the run changed nothing and was not recorded (an idle sweep, a payout update with no effect). */
  runId?: string;
  handled: boolean;
  summary: string;
  usage: Usage;
}

/** Starts the run record and the context every tool call logs to. */
async function openRun(req: AgentRunRequest): Promise<RunContext> {
  return {
    runId: await startRun(req.trigger, req),
    trigger: req.trigger,
    limits: limitsFromEnv(getEnv()),
    policyText: await loadPolicyText(),
    usage: newUsage(),
  };
}

async function failRun(ctx: RunContext, req: AgentRunRequest, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[officer] run ${ctx.runId} (${req.trigger}) failed:`, err);
  await finishRun(ctx.runId, { summary: `Run failed: ${message}`, status: "error", error: message, cost: ctx.usage, caseId: req.caseId });
}

export async function runCaseOfficer(req: AgentRunRequest): Promise<RunResult> {
  if (req.trigger === "payout.webhook") return reconcilePayoutWebhook(req);
  if (req.trigger === "sweep") return runSweep(req);

  const ctx = await openRun(req);
  try {
    let summary: string;
    switch (req.trigger) {
      case "case.created": {
        if (!req.caseId) throw new Error("case.created needs caseId");
        summary = await runSession(ctx, caseCreatedPrompt(req.caseId), MAX_STEPS_CASE);
        break;
      }
      case "donation.captured": {
        summary = await runSession(ctx, allocationPrompt(`A donation was captured (order ${req.orderId ?? "unknown"})`), MAX_STEPS_ALLOCATION);
        break;
      }
      case "operator.command": {
        // Today: the console approved cases and the agent pays them (P-8 order, every guardrail still applies).
        // The natural-language command bar (plan → confirm → execute) remains a stretch item.
        summary = await runSession(ctx, allocationPrompt(req.command ?? "An operator approved one or more cases"), MAX_STEPS_ALLOCATION);
        break;
      }
    }
    await finishRun(ctx.runId, { summary, status: "done", cost: ctx.usage, caseId: req.caseId });
    return { runId: ctx.runId, handled: true, summary, usage: ctx.usage };
  } catch (err) {
    await failRun(ctx, req, err);
    throw err;
  }
}

/** One model session: system prompt + cached policy + the trigger message, with tools, until the model stops. */
async function runSession(ctx: RunContext, userPrompt: string, maxSteps: number): Promise<string> {
  const result = await generateText({
    model: officerModel(),
    allowSystemInMessages: true,
    messages: [{ role: "system", content: OFFICER_SYSTEM }, policySystemMessage(ctx.policyText), { role: "user", content: userPrompt }],
    tools: buildTools(ctx),
    stopWhen: stepCountIs(maxSteps),
  });
  addUsage(ctx.usage, result.totalUsage);
  return result.text.trim() || `(no summary; ${result.steps.length} step(s))`;
}

/**
 * Scheduled pass: stale locks back to `new`, every new case gets its own session, P-8 over the cases
 * waiting for money (in code; a model session only when something is payable), and a PayPal poll for
 * `paying` cases whose webhook may have been lost. The run is opened by the first step that does
 * something, so an idle sweep records nothing and calls no model.
 */
async function runSweep(req: AgentRunRequest): Promise<RunResult> {
  let ctx: RunContext | undefined;
  const open = async () => (ctx ??= await openRun(req));
  const summaries: string[] = [];

  try {
    const reset = await resetStaleEvaluating();
    if (reset.length) {
      await open();
      summaries.push(`[locks] reset stale evaluation on ${reset.join(", ")}`);
    }

    const fresh = (await listCases(["new"])).slice(0, MAX_NEW_CASES_PER_SWEEP);
    for (const c of fresh) {
      const run = await open();
      try {
        summaries.push(`[${c.id}] ${await runSession(run, caseCreatedPrompt(c.id), MAX_STEPS_CASE)}`);
      } catch (err) {
        summaries.push(`[${c.id}] failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const waiting = await listCases(["approved", "parked"]);
    if (waiting.length > 0) {
      const started = Date.now();
      const plan = await planWaitingCases();
      if (plan.parkedNow.length > 0) {
        const run = await open();
        await appendToolCall(run.runId, { name: "plan_allocation", args: {}, result: { parkedNow: plan.parkedNow, balanceCents: plan.balanceCents }, policyClause: "P-8", ms: Date.now() - started, at: Timestamp.now() });
        summaries.push(`[allocation] parked ${plan.parkedNow.join(", ")}: the balance does not cover them (P-8)`);
      }
      if (plan.pay.length > 0) {
        const run = await open();
        summaries.push(`[allocation] ${await runSession(run, allocationPrompt(`Scheduled sweep: ${plan.pay.length} case(s) can be paid now`), MAX_STEPS_ALLOCATION)}`);
      }
    }

    const now = Date.now();
    const paying = (await listCases(["paying"])).filter((c) => now - (c.timestamps.approved?.toMillis() ?? c.timestamps.created.toMillis()) >= PAYING_POLL_AFTER_MS);
    for (const c of paying) {
      const started = Date.now();
      try {
        const r = await refreshPayoutStatus(c.id);
        // An item PayPal still holds (PENDING, UNCLAIMED) is polled again next time; only a poll that settles
        // or fails the payout is recorded.
        if (!r.applied.some((a) => a.changed)) continue;
        const run = await open();
        await appendToolCall(run.runId, { name: "poll_payout", args: { caseId: c.id }, result: r.applied, policyClause: "P-9", ms: Date.now() - started, at: Timestamp.now() });
        summaries.push(`[${c.id}] polled PayPal: ${r.applied.map((a) => a.status).join(", ")}`);
      } catch (err) {
        console.warn(`[officer] sweep could not poll ${c.id}:`, err instanceof Error ? err.message : err);
      }
    }

    if (!ctx) return { handled: true, summary: "Sweep: nothing to do.", usage: newUsage() };
    const summary = summaries.join("\n");
    await finishRun(ctx.runId, { summary, status: "done", cost: ctx.usage });
    return { runId: ctx.runId, handled: true, summary, usage: ctx.usage };
  } catch (err) {
    if (ctx) await failRun(ctx, req, err);
    else console.error("[officer] sweep failed before it did anything:", err);
    throw err;
  }
}

/**
 * Payout status from a verified webhook event. Deterministic; no model call. The money state is applied
 * first; a run is recorded only when the event changed something (paid, failed, reversed) or failed to apply.
 */
async function reconcilePayoutWebhook(req: AgentRunRequest): Promise<RunResult> {
  const eventId = req.eventId;
  if (!eventId) throw new Error("payout.webhook needs eventId");
  const started = Date.now();
  const usage = newUsage();

  let result: Record<string, unknown>;
  let summary: string;
  let changed = false;
  let caseId: string | undefined;
  try {
    const stored = await getWebhookEvent(eventId);
    if (!stored) throw new Error(`webhook event ${eventId} not found`);
    const event = WebhookEventSchema.parse(stored.event);
    const info = parsePayoutEvent(event);
    if (!info) {
      result = { eventId, ignored: true, eventType: event.event_type };
      summary = `${event.event_type}: not a payout item/batch event, ignored.`;
    } else {
      const applied = await applyPayoutEvent(info, "webhook", event.event_type);
      changed = applied.changed;
      caseId = applied.caseId;
      result = { eventId, ...info, ...applied };
      const who = applied.caseId ?? info.caseId ?? info.senderBatchId ?? "unknown case";
      summary = applied.note
        ? `${who}: ${event.event_type}, ${applied.note}.`
        : applied.outcome === "paid"
          ? `${who} is paid (PayPal ${event.event_type}, batch ${info.payoutBatchId ?? "?"}).`
          : applied.outcome === "failed"
            ? `${who}: payout ${info.status}${info.error ? ` (${info.error})` : ""}; reservation released and the case is back in the human queue.`
            : `${who}: payout ${info.status} recorded; waiting for a final status.`;
    }
  } catch (err) {
    // The webhook route answers 500 and PayPal retries; the failure is kept in the feed so an operator sees it.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[officer] payout webhook ${eventId} failed:`, err);
    const runId = await startRun(req.trigger, req);
    await finishRun(runId, { summary: `Run failed: ${message}`, status: "error", error: message, cost: usage });
    throw err;
  }

  if (!changed) return { handled: true, summary, usage };
  const runId = await startRun(req.trigger, req);
  await appendToolCall(runId, { name: "reconcile_payout", args: { eventId }, result, policyClause: "P-9", ms: Date.now() - started, at: Timestamp.now() });
  await finishRun(runId, { summary, status: "done", cost: usage, caseId });
  return { runId, handled: true, summary, usage };
}
