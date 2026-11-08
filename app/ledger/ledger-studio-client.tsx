"use client";

// Loads the AG Studio report in the browser only, keeps it live by checking /api/ledger every few seconds,
// and falls back to the plain ledger tables if Studio fails to load or render, so the ledger never goes blank.
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { LedgerStudioData } from "./ledger-studio";
import { reportHeight } from "./studio-layout";

const LedgerStudio = dynamic(() => import("./ledger-studio").then((m) => m.LedgerStudio), {
  ssr: false,
  loading: () => <Skeleton />,
});

function Skeleton() {
  return <div aria-busy="true" className="size-full animate-pulse rounded-2xl border border-border bg-card" />;
}

class StudioBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[ledger] AG Studio failed, showing the plain tables", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const POLL_MS = 10_000;
type Scheme = "light" | "dark";

const signature = (l: LedgerStudioData) => JSON.stringify([l.fund.raisedCents, l.fund.paidCents, l.fund.reservedCents, l.rows, l.donations]);

/** The ledger as /api/ledger has it now, re-read every POLL_MS while the tab is visible. */
function useLiveLedger(initial: LedgerStudioData): LedgerStudioData {
  const [ledger, setLedger] = useState(initial);
  const current = useRef(signature(ledger));
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/ledger", { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: LedgerStudioData };
        if (stopped || !json.ok || !json.data) return;
        const next: LedgerStudioData = { rows: json.data.rows, donations: json.data.donations, fund: json.data.fund };
        const sig = signature(next);
        if (sig !== current.current) {
          current.current = sig;
          setLedger(next);
        }
      } catch {
        // Offline or a deploy in progress: keep showing what we have and try again next time.
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);
  return ledger;
}

export function LedgerStudioClient({ ledger: initial, licenseKey, fallback }: { ledger: LedgerStudioData; licenseKey: string; fallback: ReactNode }) {
  const ledger = useLiveLedger(initial);
  // The report's height follows the layout Studio picks for this width (stacked on phones).
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  // The grids size their columns to the text once, on mount; measured before the web font loads, they
  // truncate. So the report mounts after the fonts are ready. Studio also fixes its chart colors when it
  // mounts, so a change of light or dark mode mounts it again.
  const [fontsReady, setFontsReady] = useState(false);
  const [scheme, setScheme] = useState<Scheme>();
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => live && setFontsReady(true));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => setScheme(mq.matches ? "dark" : "light");
    read();
    mq.addEventListener("change", read);
    return () => {
      live = false;
      mq.removeEventListener("change", read);
    };
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setHeight(reportHeight(el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <StudioBoundary fallback={fallback}>
      <p className="mb-3 flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        Live: new donations and payouts appear here within seconds
      </p>
      {/* Studio insets every widget by 6px, so the box reaches 6px past each side to line the cards up with the page. */}
      <div ref={box} className="ledger-report -mx-1.5" style={{ width: "calc(100% + 12px)", height: height ?? reportHeight(1024) }}>
        {fontsReady && scheme ? <LedgerStudio key={scheme} ledger={ledger} licenseKey={licenseKey} /> : <Skeleton />}
      </div>
    </StudioBoundary>
  );
}
