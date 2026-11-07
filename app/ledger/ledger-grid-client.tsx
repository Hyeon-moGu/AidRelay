"use client";

import dynamic from "next/dynamic";
import type { LedgerRow } from "@/lib/ledger/public";

const LedgerGrid = dynamic(() => import("./ledger-grid").then((m) => m.LedgerGrid), { ssr: false, loading: () => <p className="text-sm text-zinc-500">Loading…</p> });

export function LedgerGridClient({ rows }: { rows: LedgerRow[] }) {
  return <LedgerGrid rows={rows} />;
}
