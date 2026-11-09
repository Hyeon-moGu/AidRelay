"use client";

// Loads the auditor's AG Studio in the browser only (it needs the DOM and pulls in Studio's AI module).
import dynamic from "next/dynamic";
import type { LedgerStudioData } from "@/app/ledger/ledger-studio";

const AuditStudio = dynamic(() => import("./audit-studio").then((m) => m.AuditStudio), {
  ssr: false,
  loading: () => <div aria-busy="true" className="size-full animate-pulse rounded-xl border border-border bg-card" />,
});

export function AuditClient(props: { ledger: LedgerStudioData; licenseKey: string; policyFacts: string; canAsk: boolean }) {
  return <AuditStudio {...props} />;
}
