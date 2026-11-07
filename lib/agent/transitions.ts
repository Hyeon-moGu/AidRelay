// Case status state machine, per actor. Every status write goes through assertTransition
// (lib/db/repos/cases.ts), so neither the model nor a bug can move a case along an edge
// that is not listed here. Same-status writes are idempotent no-ops (except agent → rejected).
import { GuardrailError } from "@/lib/agent/guardrails";
import type { CaseStatus } from "@/lib/agent/schema";
import type { AuditActor } from "@/lib/db/types";

export type ActorKind = "agent" | "system" | "human";

export function actorKind(actor: AuditActor): ActorKind {
  if (actor === "agent") return "agent";
  if (actor === "system") return "system";
  return "human";
}

type Table = Record<CaseStatus, readonly CaseStatus[]>;

const NONE: readonly CaseStatus[] = [];

export const TRANSITIONS: Record<ActorKind, Table> = {
  agent: {
    new: ["evaluating", "needs_info", "needs_review", "parked", "approved"],
    evaluating: ["needs_info", "needs_review", "parked", "approved"],
    needs_info: NONE, // waits for the applicant
    needs_review: NONE, // a human owns it
    parked: ["approved"], // money arrived
    approved: ["paying", "parked", "needs_review"], // pay it, park it, or (P-10) send it to a human — never if a human approved it, see assertTransition
    paying: NONE,
    paid: NONE,
    rejected: NONE,
  },
  system: {
    new: ["evaluating"],
    evaluating: ["new"],
    needs_info: ["new"], // applicant answered → re-evaluate
    needs_review: NONE,
    parked: ["approved"],
    approved: ["paying", "parked", "paid", "needs_review"], // paid / needs_review: a batch PayPal accepted after a timeout settled or failed
    paying: ["paid", "needs_review", "approved"], // webhook success / failure / PayPal refused the batch
    paid: ["needs_review"], // money came back (REFUNDED / REVERSED / RETURNED after SUCCESS)
    rejected: NONE,
  },
  human: {
    new: ["needs_review", "rejected"],
    evaluating: ["needs_review"],
    needs_info: ["approved", "needs_review", "rejected", "new"],
    needs_review: ["approved", "needs_info", "rejected", "parked"],
    parked: ["approved", "rejected", "needs_review"],
    approved: ["rejected", "needs_review", "parked"],
    paying: NONE,
    paid: NONE,
    rejected: ["needs_review"], // reopen
  },
};

export interface TransitionContext {
  /** The case carries a human approval; the agent may then only pay or park it. */
  humanApproved?: boolean;
}

export function canTransition(actor: AuditActor, from: CaseStatus, to: CaseStatus, ctx: TransitionContext = {}): boolean {
  const kind = actorKind(actor);
  if (kind === "agent" && to === "rejected") return false;
  if (from === to) return true;
  if (kind === "agent" && ctx.humanApproved && to !== "paying" && to !== "parked") return false;
  return TRANSITIONS[kind][from].includes(to);
}

export function assertTransition(actor: AuditActor, from: CaseStatus, to: CaseStatus, ctx: TransitionContext = {}): void {
  const kind = actorKind(actor);
  if (kind === "agent" && to === "rejected") {
    throw new GuardrailError("agent_cannot_reject", "the agent may never set rejected", "P-9");
  }
  if (from === to) return;
  if (kind === "agent" && ctx.humanApproved && to !== "paying" && to !== "parked") {
    throw new GuardrailError("human_override", `the agent may not move a human-approved case from ${from} to ${to}`, "P-9");
  }
  if (!TRANSITIONS[kind][from].includes(to)) {
    throw new GuardrailError("illegal_transition", `${kind} may not move a case from ${from} to ${to}`, "P-9");
  }
}
