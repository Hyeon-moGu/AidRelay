// Hands an event to the Case Officer without blocking the caller.
// The run endpoint (app/api/agent/run) is protected by AGENT_INTERNAL_SECRET.
import { getEnv } from "@/lib/env";

export const AGENT_TRIGGERS = [
  "case.created",
  "donation.captured",
  "payout.webhook",
  "operator.command",
  "sweep",
] as const;
export type AgentTrigger = (typeof AGENT_TRIGGERS)[number];

export interface AgentRunRequest {
  trigger: AgentTrigger;
  caseId?: string;
  orderId?: string;
  eventId?: string;
  /** operator.command: what the operator did or asked for (plain English, shown in the feed). */
  command?: string;
}

/** Fire-and-forget. Failures are logged, never thrown: the money record is already committed. */
export function enqueueAgentRun(payload: AgentRunRequest): void {
  const env = getEnv();
  void fetch(`${env.APP_URL}/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-secret": env.AGENT_INTERNAL_SECRET },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) console.error("[agent.trigger] run endpoint returned", res.status, await res.text());
    })
    .catch((err) => console.error("[agent.trigger] could not reach run endpoint", err));
}
