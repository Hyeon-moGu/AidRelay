"use client";

// Small client pieces of the status page: a quiet refresh while the case is moving on its own, and step
// times in the applicant's own time zone.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the server page every few seconds while `active`, so a payment shows up without a reload. */
export function AutoRefresh({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}

/**
 * "2:14 PM" today, "Nov 8, 2:14 PM" on other days, in the viewer's time zone and language. Formatted after
 * mount: the server's time zone (UTC on Cloud Run) is not the applicant's.
 */
export function StepTime({ iso, lang }: { iso: string; lang: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    const opts: Intl.DateTimeFormatOptions = sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    setText(new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", opts).format(d));
  }, [iso, lang]);
  return (
    <time dateTime={iso} className="text-[13px] text-muted-foreground tabular-nums">
      {text}
    </time>
  );
}
