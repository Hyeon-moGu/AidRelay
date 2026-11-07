"use client";

import dynamic from "next/dynamic";
import type { LedgerRow } from "@/lib/ledger/public";

const LedgerGrid = dynamic(() => import("./ledger-grid").then((m) => m.LedgerGrid), {
  ssr: false,
  loading: () => <div aria-busy="true" className="h-[320px] animate-pulse rounded-xl border border-border bg-card" />,
});

export function LedgerGridClient({ rows }: { rows: LedgerRow[] }) {
  return <LedgerGrid rows={rows} />;
}
