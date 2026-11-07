// runCaseOfficer(trigger): the event-driven agent (AGENTS.md §8, docs/CONCEPT.md §5).
// Model sessions for case evaluation and allocation; payout webhooks are reconciled in code.
import { generateText, stepCountIs } from "ai";
import { Timestamp } from "firebase-admin/firestore";
import { limitsFromEnv } from "@/lib/agent/guardrails";
import { addUsage, officerModel, type Usage } from "@/lib/agent/models";
import { loadPolicyText } from "@/lib/agent/policy";
import { allocationPrompt, caseCreatedPrompt, OFFICER_SYSTEM, policySystemMessage } from "@/lib/agent/prompts";
import { buildTools, type RunContext } from "@/lib/agent/tools";
import type { AgentRunRequest } from "@/lib/agent/trigger";
import { appendToolCall, finishRun, startRun } from "@/lib/db/repos/agentRuns";
import { listCases } from "@/lib/db/repos/cases";
import { applyPayoutEvent } from "@/lib/db/repos/payouts";
import { getWebhookEvent } from "@/lib/db/repos/webhookEvents";
import { getEnv } from "@/lib/env";
import { WebhookEventSchema } from "@/lib/paypal/events";
import { parsePayoutEvent } from "@/lib/paypal/payouts";

const MAX_STEPS_CASE = 16;
const MAX_STEPS_ALLOCATION = 48;
const MAX_NEW_CASES_PER_SWEEP = 25;

export interface RunResult {
  runId: string;
  handled: boolean;
  summary: string;
  usage: Usage;
}

export async function runCaseOfficer(req: AgentRunRequest): Promise<RunResult> {
  const runId = await startRun(req.trigger, req);
  const env = getEnv();
  const ctx: RunContext = {
    runId,
    trigger: req.trigger,
    limits: limitsFromEnv(env),
    policyText: await loadPolicyText(),
    usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
  };

  try {
    let summary: string;
    let handled = true;
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
      case "payout.webhook": {
        if (!req.eventId) throw new Error("payout.webhook needs eventId");
        summary = await reconcilePayoutEvent(ctx, req.eventId);
        break;
      }
      case "sweep": {
        summary = await runSweep(ctx);
        break;
      }
      case "operator.command": {
        summary = "operator.command is a stretch feature and is not implemented yet.";
        handled = false;
        break;
      }
    }
    await finishRun(runId, { summary, status: "done", cost: ctx.usage, caseId: req.caseId });
    return { runId, handled, summary, usage: ctx.usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[officer] run ${runId} (${req.trigger}) failed:`, err);
    await finishRun(runId, { summary: `Run failed: ${message}`, status: "error", error: message, cost: ctx.usage, caseId: req.caseId });
    throw err;
  }
}

/** One model session: system prompt + cached policy + the trigger message, with tools, until the model stops. */
async function runSession(ctx: RunContext, userPrompt: string, maxSteps: number): Promise<string> {
  const result = await generateText({
    model: officerModel(),
    messages: [{ role: "system", content: OFFICER_SYSTEM }, policySystemMessage(ctx.policyText), { role: "user", content: userPrompt }],
    tools: buildTools(ctx),
    stopWhen: stepCountIs(maxSteps),
  });
  addUsage(ctx.usage, result.totalUsage);
  return result.text.trim() || `(no summary; ${result.steps.length} step(s))`;
}

/** Scheduled pass: every new case gets its own session, then one allocation session for approved + parked cases. */
async function runSweep(ctx: RunContext): Promise<string> {
  const summaries: string[] = [];
  const fresh = (await listCases(["new"])).slice(0, MAX_NEW_CASES_PER_SWEEP);
  for (const c of fresh) {
    try {
      summaries.push(`[${c.id}] ${await runSession(ctx, caseCreatedPrompt(c.id), MAX_STEPS_CASE)}`);
    } catch (err) {
      summaries.push(`[${c.id}] failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const waiting = await listCases(["approved", "parked"]);
  if (waiting.length > 0) {
    summaries.push(`[allocation] ${await runSession(ctx, allocationPrompt(`Scheduled sweep: ${waiting.length} case(s) are waiting for money`), MAX_STEPS_ALLOCATION)}`);
  }
  return summaries.length ? summaries.join("\n") : "Sweep: nothing to do.";
}

/** Payout status from a verified webhook event. Deterministic; no model call. */
async function reconcilePayoutEvent(ctx: RunContext, eventId: string): Promise<string> {
  const started = Date.now();
  const stored = await getWebhookEvent(eventId);
  if (!stored) throw new Error(`webhook event ${eventId} not found`);
  const event = WebhookEventSchema.parse(stored.event);
  const info = parsePayoutEvent(event);
  let result: Record<string, unknown>;
  let summary: string;
  if (!info) {
    result = { eventId, ignored: true, eventType: event.event_type };
    summary = `${event.event_type}: not a payout item/batch event, ignored.`;
  } else {
    const applied = await applyPayoutEvent(info, "webhook", event.event_type);
    result = { eventId, ...info, ...applied };
    summary =
      applied.outcome === "paid"
        ? `${info.caseId} is paid (PayPal ${event.event_type}, batch ${info.payoutBatchId ?? "?"}).`
        : applied.outcome === "failed"
          ? `${info.caseId}: payout ${info.status}${info.error ? ` (${info.error})` : ""}; reservation released and the case is back in the human queue.`
          : `${info.caseId}: payout ${info.status} recorded; waiting for a final status.`;
  }
  await appendToolCall(ctx.runId, { name: "reconcile_payout", args: { eventId }, result, policyClause: "P-9", ms: Date.now() - started, at: Timestamp.now() });
  return summary;
}
