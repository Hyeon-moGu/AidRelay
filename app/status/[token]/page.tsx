// The applicant's status page: reachable only by the unguessable token, no login.
import { Bookmark, Check, CircleCheck, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import { Brand } from "@/components/site/brand";
import { STATUS_TONE, TONE_CLASS } from "@/components/status-badge";
import { amountForCase } from "@/lib/agent/tools";
import { getCaseByToken } from "@/lib/db/repos/cases";
import { MESSAGES, normalizeLang, TIMELINE } from "@/lib/i18n/messages";
import { formatMoney } from "@/lib/money";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Your application · AidRelay" };
export const dynamic = "force-dynamic";

function Shell({ lang, children }: { lang: string; children: React.ReactNode }) {
  return (
    <div lang={lang} className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6">
      <div className="flex h-14 items-center pt-[env(safe-area-inset-top)]">
        <Brand />
      </div>
      <main id="main" className="mt-6 space-y-6">
        {children}
      </main>
    </div>
  );
}

export default async function StatusPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; sent?: string }> }) {
  const { token } = await params;
  const { lang: langParam, sent } = await searchParams;
  const c = /^[0-9a-f]{32}$/.test(token) ? await getCaseByToken(token) : undefined;
  const lang = normalizeLang(langParam ?? c?.lang);
  const t = MESSAGES[lang];
  const s = t.status_page;

  if (!c) {
    return (
      <Shell lang={lang}>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{s.title}</h1>
        <p className="leading-relaxed text-muted-foreground">{s.notFound}</p>
      </Shell>
    );
  }

  const reached = TIMELINE.indexOf(c.status === "needs_info" || c.status === "needs_review" || c.status === "parked" ? "evaluating" : c.status);
  const amount = amountForCase(c);
  const showAmount = ["approved", "parked", "paying", "paid"].includes(c.status) && amount !== null;
  const tone = STATUS_TONE[c.status] ?? "wait";
  const received = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium" }).format(c.timestamps.created.toDate());
  const rejected = c.status === "rejected";

  return (
    <Shell lang={lang}>
      <div>
        <p className="text-sm text-muted-foreground">
          {s.caseLabel}{" "}
          <span className="font-mono text-foreground" translate="no">
            {c.id}
          </span>{" "}
          · {s.received} {received}
        </p>
        <h1 className="mt-1 text-[1.75rem] font-semibold tracking-[-0.02em]">{s.title}</h1>
      </div>

      <section aria-labelledby="current" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}>
            {c.status === "paid" ? <CircleCheck className="size-5" /> : <span className="size-2.5 rounded-full bg-current" />}
          </span>
          <div className="min-w-0">
            <h2 id="current" className="text-xl font-semibold tracking-tight">
              {t.status[c.status]}
            </h2>
            <p className="mt-1 leading-relaxed text-muted-foreground">{t.statusHint[c.status]}</p>
          </div>
        </div>
        {(showAmount || c.payoutBatchId) && (
          <dl className="mt-5 space-y-2 border-t border-border pt-5">
            {showAmount && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-muted-foreground">{s.amount}</dt>
                <dd className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">{formatMoney(amount)}</dd>
              </div>
            )}
            {c.payoutBatchId && (
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-muted-foreground">{s.batch}</dt>
                <dd className="truncate font-mono" translate="no">
                  {c.payoutBatchId}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {c.applicantMessage && (
        <section aria-labelledby="msg" className="rounded-2xl bg-warning-soft p-5">
          <h2 id="msg" className="flex items-center gap-2 text-sm font-semibold text-warning">
            <MessageSquare aria-hidden="true" className="size-4" />
            {s.message}
          </h2>
          <p className="mt-2 leading-relaxed whitespace-pre-line text-foreground">{c.applicantMessage.text}</p>
        </section>
      )}

      {c.status === "needs_info" && !sent && <ReplyForm token={token} lang={lang} />}
      {sent && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-success-soft p-4 text-sm font-medium text-success">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {s.replySent}
        </p>
      )}

      <section aria-labelledby="timeline">
        <h2 id="timeline" className="text-sm font-medium text-muted-foreground">
          {s.timeline}
        </h2>
        <ol className="mt-4">
          {TIMELINE.map((st, i) => {
            const done = c.status === "paid" ? true : i < reached;
            const current = !done && i === reached;
            const struck = rejected && st !== "new";
            return (
              <li key={st} aria-current={current ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0">
                {i < TIMELINE.length - 1 && (
                  <span aria-hidden="true" className={`absolute top-7 bottom-1 left-[11px] w-px ${done ? "bg-primary" : "bg-border"}`} />
                )}
                <span
                  aria-hidden="true"
                  className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${
                    done ? "bg-primary text-primary-foreground" : current ? "border-2 border-primary bg-card" : "border border-input/50 bg-card"
                  }`}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : current ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className={`pt-0.5 text-sm ${current ? "font-medium" : done ? "" : "text-muted-foreground"} ${struck ? "line-through decoration-muted-foreground" : ""}`}>
                  {t.status[st]}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
        <Bookmark aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {s.keepLink}
      </p>
    </Shell>
  );
}
