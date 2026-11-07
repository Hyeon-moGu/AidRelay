// Shared types for cases and the Case Officer's decision.
// The Decision shape is mirrored in docs/CONCEPT.md §6; keep both in sync (camelCase everywhere).
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
] as const;
export type RedFlag = (typeof RED_FLAGS)[number];

export const POLICY_CLAUSE = z.string().regex(/^P-\d+$/, "policy clause id like P-3");

export const DecisionSchema = z.strictObject({
  eligibility: z.enum(["eligible", "ineligible", "needs_info"]),
  tier: z.number().int().min(1).max(4).nullable(),
  recommendedAmountCents: z.number().int().nonnegative().nullable(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(
    z.strictObject({
      clause: POLICY_CLAUSE,
      evidence: z.string().min(1),
    }),
  ),
  redFlags: z.array(z.enum(RED_FLAGS)),
  followUpQuestions: z.array(z.string().min(1)),
  applicantLanguage: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "BCP-47 like en or es"),
  /** The only AI-written text that reaches the public ledger. Must contain no PII. */
  ledgerSummary: z.string().min(1).max(140),
});
export type Decision = z.infer<typeof DecisionSchema>;
