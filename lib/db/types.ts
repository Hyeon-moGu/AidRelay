// Firestore document shapes (AGENTS.md §5). Money is integer cents; field names are camelCase.
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

export interface CaseDoc {
  id: string;
  /** Unguessable token for /status/[token]. */
  token: string;
  lang: string;
  zip: string;
  householdSize: number | null;
  requestedAmountCents: number | null;
  narrative: string;
  photos: string[];
  docs: string[];
  /** Private. Never copied to the ledger. */
  contact: CaseContact;
  status: CaseStatus;
  tier?: number | null;
  aiDecision?: Decision;
  humanDecision?: HumanDecision;
  redFlags?: RedFlag[];
  reservedCents?: number;
  payoutBatchId?: string;
  timestamps: {
    created: Timestamp;
    evaluated?: Timestamp;
    approved?: Timestamp;
    paid?: Timestamp;
  };
}

export interface PayoutDoc {
  caseId: string;
  /** = caseId: one payout per case, idempotent (AGENTS.md §1.3). */
  senderBatchId: string;
  payoutBatchId?: string;
  amountCents: number;
  currency: string;
  recipientEmail: string;
  status: string;
  events: Array<{ type: string; status?: string; at: Timestamp }>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AgentRunDoc {
  id: string;
  trigger: string;
  caseId?: string;
  toolCalls: Array<{ name: string; args: unknown; result?: unknown; policyClause?: string; ms?: number }>;
  summary: string;
  cost?: { inputTokens: number; outputTokens: number; usd?: number };
  ts: Timestamp;
}
