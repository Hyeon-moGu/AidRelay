// Firestore document shapes. Money is integer cents; field names are camelCase.
import type { Timestamp } from "firebase-admin/firestore";
import type { CaseStatus, Decision, RedFlag } from "@/lib/agent/schema";

export interface FundDoc {
  id: string;
  name: string;
  currency: string;
  raisedCents: number;
  paidCents: number;
  reservedCents: number;
  policyVersion: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export function fundBalanceCents(f: Pick<FundDoc, "raisedCents" | "paidCents" | "reservedCents">): number {
  return f.raisedCents - f.paidCents - f.reservedCents;
}

export type DonationStatus = "created" | "pending" | "captured" | "failed";

export interface DonationDoc {
  orderId: string;
  fundId: string;
  amountCents: number;
  currency: string;
  status: DonationStatus;
  captureId?: string;
  captureStatus?: string;
  /** HMAC of the payer email; never the email itself. */
  donorRef?: string;
  /** Which path recorded the capture first: the capture API call or the webhook. */
  source?: "api" | "webhook";
  /** PayPal response with PII stripped (lib/ledger/anonymize.ts). */
  raw?: Record<string, unknown>;
  createdAt: Timestamp;
  capturedAt?: Timestamp;
}

export type AuditActor = "agent" | "system" | `human:${string}`;

export interface AuditDoc {
  actor: AuditActor;
  caseId?: string;
  action: string;
  policyClause?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  refs?: Record<string, string>;
  ts: Timestamp;
}

export interface WebhookEventDoc {
  id: string;
  eventType: string;
  resourceType?: string;
  summary?: string;
  createTime?: string;
  receivedAt: Timestamp;
  handled: boolean;
  handledAt?: Timestamp;
  outcome?: Record<string, unknown>;
  /** Event payload with PII stripped. */
  event: Record<string, unknown>;
}

export interface CaseContact {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
}

export interface HumanDecision {
  approved: boolean;
  by: string;
  amountCents?: number;
  note?: string;
  at: Timestamp;
}

export interface DupMatch {
  caseId: string;
  by: Array<"photo" | "address" | "contact">;
  /** Smallest hash distance among matching photos, when `by` includes "photo". */
  photoDistance?: number;
}

export interface CaseDoc {
  id: string;
  /** Unguessable token for /status/[token]. */
  token: string;
  lang: string;
  zip: string;
  householdSize: number | null;
  requestedAmountCents: number | null;
  narrative: string;
  /** GCS object paths. */
  photos: string[];
  docs: string[];
  /** dHash per photo, computed at intake (lib/dedupe/phash.ts). */
  photoHashes?: string[];
  /** Private. Never copied to the ledger. */
  contact: CaseContact;
  status: CaseStatus;
  tier?: number | null;
  aiDecision?: Decision;
  /** P-9.9: the second, independent evaluation run before an unattended payout. */
  aiDecisionSecond?: Decision;
  /** P-9.8: usable photos/documents counted at evaluation time. */
  usableEvidenceCount?: number;
  /** P-9.9: the second evaluation matched the first on eligibility and tier. */
  secondEvaluationAgrees?: boolean;
  /** Set while a run holds the evaluation lock; a stale lock is reclaimed after 10 minutes. */
  evaluatingSince?: Timestamp;
  /** Amount the fund will pay: the human's figure if set, else the agent's recommendation. */
  approvedAmountCents?: number;
  humanDecision?: HumanDecision;
  redFlags?: RedFlag[];
  dupMatches?: DupMatch[];
  /** Follow-up shown on the applicant's status page (policy §6). */
  applicantMessage?: { lang: string; text: string; at: Timestamp };
  reservedCents?: number;
  payoutBatchId?: string;
  notes?: Array<{ by: AuditActor; text: string; at: Timestamp }>;
  lastRunId?: string;
  timestamps: {
    created: Timestamp;
    evaluated?: Timestamp;
    approved?: Timestamp;
    paid?: Timestamp;
  };
}

export type PayoutStatus =
  | "creating"
  | "create_failed"
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "DENIED"
  | "CANCELED"
  | "UNCLAIMED"
  | "FAILED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED"
  | "NEW"
  | string;

export interface PayoutDoc {
  caseId: string;
  /** `${caseId}-${token prefix}`: unique per case instance, so reseeds never collide on PayPal's idempotency window. One payout per case is enforced by this document's existence. */
  senderBatchId: string;
  payoutBatchId?: string;
  payoutItemId?: string;
  transactionId?: string;
  amountCents: number;
  currency: string;
  recipientEmail: string;
  /** Item-level transaction status (SUCCESS, UNCLAIMED, FAILED, …) or `creating` / `create_failed` before PayPal answered. */
  status: PayoutStatus;
  /** Batch-level status from PAYOUTSBATCH events / the create response (PENDING, PROCESSING, SUCCESS, DENIED). */
  batchStatus?: string;
  /** Whether this payout was made without a human (P-10 bookkeeping lives in auto_approvals). */
  autoApproved?: boolean;
  outcome: "pending" | "paid" | "failed" | "create_failed" | "reversed";
  error?: string;
  events: Array<{ type: string; status?: string; source: "api" | "webhook" | "poll"; at: Timestamp }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  policyClause?: string;
  ms: number;
  at: Timestamp;
  error?: string;
}

export interface AgentRunDoc {
  id: string;
  trigger: string;
  caseId?: string;
  orderId?: string;
  eventId?: string;
  status: "running" | "done" | "error";
  toolCalls: ToolCallRecord[];
  summary: string;
  cost?: { inputTokens: number; outputTokens: number; modelCalls: number };
  error?: string;
  ts: Timestamp;
  finishedAt?: Timestamp;
}
