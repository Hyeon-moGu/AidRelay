import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { assertAgentStatusWrite } from "@/lib/agent/guardrails";
import type { CaseStatus } from "@/lib/agent/schema";
import { col, getDb } from "@/lib/db/firestore";
import { auditInTx, writeAudit } from "@/lib/db/repos/audit";
import type { AuditActor, CaseContact, CaseDoc } from "@/lib/db/types";

export interface NewCaseInput {
  id?: string;
  lang: string;
  zip: string;
  householdSize: number | null;
  requestedAmountCents: number | null;
  narrative: string;
  photos: string[];
  docs: string[];
  photoHashes?: string[];
  contact: CaseContact;
  createdAt?: Timestamp;
}

export async function createCase(input: NewCaseInput, actor: AuditActor = "system"): Promise<CaseDoc> {
  const id = input.id ?? `C-${randomBytes(3).toString("hex").toUpperCase()}`;
  const doc: CaseDoc = {
    id,
    token: randomBytes(16).toString("hex"),
    lang: input.lang,
    zip: input.zip,
    householdSize: input.householdSize,
    requestedAmountCents: input.requestedAmountCents,
    narrative: input.narrative,
    photos: input.photos,
    docs: input.docs,
    photoHashes: input.photoHashes,
    contact: input.contact,
    status: "new",
    timestamps: { created: input.createdAt ?? Timestamp.now() },
  };
  await getDb().collection(col.cases).doc(id).create(doc);
  await writeAudit({ actor, caseId: id, action: "case.created", after: { status: "new" }, reason: "application received" });
  return doc;
}

export async function getCase(id: string): Promise<CaseDoc | undefined> {
  const snap = await getDb().collection(col.cases).doc(id).get();
  return snap.exists ? (snap.data() as CaseDoc) : undefined;
}

export async function getCaseByToken(token: string): Promise<CaseDoc | undefined> {
  const snap = await getDb().collection(col.cases).where("token", "==", token).limit(1).get();
  return snap.empty ? undefined : (snap.docs[0].data() as CaseDoc);
}

/** Cases in any of `statuses`, oldest first. Sorted in memory to avoid a composite index (demo scale). */
export async function listCases(statuses: readonly CaseStatus[], limit = 200): Promise<CaseDoc[]> {
  if (statuses.length === 0) return [];
  const snap = await getDb().collection(col.cases).where("status", "in", [...statuses]).limit(limit).get();
  return snap.docs.map((d) => d.data() as CaseDoc).sort((a, b) => a.timestamps.created.toMillis() - b.timestamps.created.toMillis());
}

export async function listAllCases(limit = 500): Promise<CaseDoc[]> {
  const snap = await getDb().collection(col.cases).limit(limit).get();
  return snap.docs.map((d) => d.data() as CaseDoc);
}

export interface CaseAudit {
  actor: AuditActor;
  action: string;
  reason: string;
  policyClause?: string;
}

/** Status transition with audit. The agent cannot write `rejected` (AGENTS.md §1.2). */
export async function setCaseStatus(
  id: string,
  status: CaseStatus,
  audit: CaseAudit,
  patch: Partial<Omit<CaseDoc, "id" | "status">> = {},
): Promise<CaseDoc> {
  if (audit.actor === "agent") assertAgentStatusWrite(status);
  const db = getDb();
  const ref = db.collection(col.cases).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`case ${id} not found`);
    const before = snap.data() as CaseDoc;
    const now = Timestamp.now();
    const timestamps = { ...before.timestamps, ...(patch.timestamps ?? {}) };
    if (status === "approved" && !timestamps.approved) timestamps.approved = now;
    if (status === "paid" && !timestamps.paid) timestamps.paid = now;
    const update: Partial<CaseDoc> = { ...patch, status, timestamps };
    tx.set(ref, update, { merge: true });
    auditInTx(tx, {
      actor: audit.actor,
      caseId: id,
      action: audit.action,
      policyClause: audit.policyClause,
      before: { status: before.status },
      after: { status, ...summarize(patch) },
      reason: audit.reason,
    });
    return { ...before, ...update } as CaseDoc;
  });
}

/** Field update without a status change, audited. */
export async function updateCase(id: string, patch: Partial<Omit<CaseDoc, "id">>, audit: CaseAudit): Promise<void> {
  const db = getDb();
  const ref = db.collection(col.cases).doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`case ${id} not found`);
    tx.set(ref, patch, { merge: true });
    auditInTx(tx, {
      actor: audit.actor,
      caseId: id,
      action: audit.action,
      policyClause: audit.policyClause,
      after: summarize(patch),
      reason: audit.reason,
    });
  });
}

function summarize(patch: Partial<CaseDoc>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "contact" || k === "token") continue; // never copy PII into the audit log
    out[k] = v;
  }
  return out;
}

/** "1180 Low Gap Road, Cedar Falls" and "1180 low gap rd cedar falls" compare equal. */
export function normalizeAddress(address: string | null | undefined): string | undefined {
  if (!address) return undefined;
  const abbreviations: Record<string, string> = {
    road: "rd",
    street: "st",
    avenue: "ave",
    lane: "ln",
    drive: "dr",
    court: "ct",
    boulevard: "blvd",
    apartment: "apt",
    unit: "apt",
    north: "n",
    south: "s",
    east: "e",
    west: "w",
  };
  const words = address
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => abbreviations[w] ?? w);
  return words.length ? words.join(" ") : undefined;
}

export function normalizeEmail(email: string | null | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e || undefined;
}

export function normalizePhone(phone: string | null | undefined): string | undefined {
  const digits = phone?.replace(/\D/g, "");
  return digits && digits.length >= 7 ? digits.slice(-10) : undefined;
}
