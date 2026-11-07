// Shared types for cases and the Case Officer's decision.
// The Decision shape is mirrored in docs/CONCEPT.md §6; keep both in sync (camelCase everywhere).
//
// The schema is deliberately permissive on formats (no regex / length / range constraints): the
// Anthropic provider strips those from the JSON schema it sends, so they would only be enforced
// client-side and turn a trivial slip (a 141-char summary, "P-9.3") into a failed evaluation.
// Format rules are applied in code by normalizeDecision (lib/agent/evaluate.ts).
import { z } from "zod";

export const CASE_STATUSES = [
  "new",
  "evaluating",
  "needs_info",
  "needs_review",
  "approved",
  "parked",
  "paying",
  "paid",
  "rejected",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses the agent is allowed to write. `rejected` is deliberately absent (AGENTS.md §1.2). */
export const AGENT_WRITABLE_STATUSES: readonly CaseStatus[] = CASE_STATUSES.filter(
  (s) => s !== "rejected",
);

export const RED_FLAGS = [
  "duplicate_photo_hash",
  "duplicate_address",
  "duplicate_contact",
  "zip_outside_declared_area",
  "amount_outlier",
  "evidence_mismatch",
  /** The narrative addresses the system or tries to dictate the outcome (prompt injection). */
  "instruction_in_narrative",
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

/** Policy clause ids look like P-3 or P-9.3. */
export const POLICY_CLAUSE_RE = /^P-\d+(\.\d+)?$/;

export const DecisionSchema = z.strictObject({
  eligibility: z.enum(["eligible", "ineligible", "needs_info"]),
  /** 1–4, or null when the evidence does not place the case. Range enforced in code. */
  tier: z.number().int().nullable(),
  /** Informational: the code recomputes the amount from the tier (P-6/P-7). */
  recommendedAmountCents: z.number().int().nullable(),
  /** 0–1; clamped in code. */
  confidence: z.number(),
  reasons: z.array(
    z.strictObject({
      clause: z.string(),
      evidence: z.string(),
    }),
  ),
  redFlags: z.array(z.enum(RED_FLAGS)),
  followUpQuestions: z.array(z.string()),
  /** Two-letter language code; normalized in code. */
  applicantLanguage: z.string(),
  /** The only AI-written text that reaches the public ledger. Scrubbed and cut to 140 chars in code. */
  ledgerSummary: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;
