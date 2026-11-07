// Firestore (firebase-admin) singleton. Server-only.
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getEnv } from "@/lib/env";

/** Firestore collection names. */
export const col = {
  fund: "fund",
  cases: "cases",
  donations: "donations",
  payouts: "payouts",
  auditLog: "audit_log",
  agentRuns: "agent_runs",
  webhookEvents: "webhook_events",
  autoApprovals: "auto_approvals",
} as const;

let db: Firestore | undefined;

export function getDb(): Firestore {
  if (db) return db;
  const env = getEnv();
  const app =
    getApps()[0] ??
    initializeApp({
      // GOOGLE_APPLICATION_CREDENTIALS points at the service-account JSON (local file or Render secret file).
      credential: applicationDefault(),
      projectId: env.FIREBASE_PROJECT_ID,
    });
  db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() may only be called once per instance; a second module evaluation is harmless.
  }
  return db;
}
