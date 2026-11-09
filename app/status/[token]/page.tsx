// The applicant's status page: reachable only by the unguessable token, no login.
import { Bookmark, Check, CircleCheck, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { Brand } from "@/components/site/brand";
import { STATUS_TONE, TONE_CLASS } from "@/components/status-badge";
import { amountForCase } from "@/lib/agent/tools";
import type { CaseStatus } from "@/lib/agent/schema";
import { getCaseByToken } from "@/lib/db/repos/cases";
import { getPayout } from "@/lib/db/repos/payouts";
import type { CaseDoc, PayoutDoc } from "@/lib/db/types";
import { duration, moneyWhole } from "@/lib/format";
import { MESSAGES, normalizeLang, TIMELINE, type Lang } from "@/lib/i18n/messages";
import { AutoRefresh, StepTime } from "./live";
import { ReplyForm } from "./reply-form";

export const dynamic = "force-dynamic";

type Step = (typeof TIMELINE)[number];

/** Which step is in progress for each status; every step before it is done. */
const CURRENT_STEP: Partial<Record<CaseStatus, Step>> = {
  new: "evaluating",
  evaluating: "evaluating",
  needs_info: "evaluating",
  needs_review: "evaluating",
  approved: "paying",
  parked: "paying",
  paying: "paying",
};

/** Statuses that change without the applicant doing anything, so the page refreshes itself. */
const MOVING: CaseStatus[] = ["new", "evaluating", "needs_review", "approved", "parked", "paying"];

const lookup = (token: string) => (/^[0-9a-f]{32}$/.test(token) ? getCaseByToken(token) : Promise.resolve(undefined));

export async function generateMetadata({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }): Promise<Metadata> {
  const { lang } = await searchParams;
  const resolved = normalizeLang(lang ?? (await lookup((await params).token))?.lang);
  return { title: `${MESSAGES[resolved].status_page.metaTitle} · AidRelay` };
}

function stepTime(c: CaseDoc, step: Step, payout: PayoutDoc | undefined): string | undefined {
  const t = { new: c.timestamps.created, evaluating: c.timestamps.evaluated, approved: c.timestamps.approved, paid: c.timestamps.paid, paying: payout?.createdAt }[step];
  return t?.toDate().toISOString();
}

function Shell({ lang, token, children }: { lang: Lang; token: string; children: React.ReactNode }) {
  const label = MESSAGES[lang].apply.language;
  return (
    <div lang={lang} className="mx-auto min-h-dvh w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6">
      <div className="flex h-14 items-center justify-between pt-[env(safe-area-inset-top)]">
        <Brand />
        <nav aria-label={label} className="flex rounded-lg bg-muted p-0.5 text-[13px]">
          {(["en", "es"] as Lang[]).map((l) => (
            <Link
              key={l}
              href={`/status/${token}?lang=${l}`}
              lang={l}
              aria-current={lang === l ? "true" : undefined}
              className={cn(
                "relative rounded-md px-2.5 py-1.5 font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
                lang === l ? "bg-card text-foreground shadow-[0_1px_2px_rgba(20,24,28,0.08)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l === "en" ? "English" : "Español"}
            </Link>
          ))}
        </nav>
      </div>
      <main id="main" className="mt-6 space-y-6">
        {children}
      </main>
    </div>
  );
}

/** The fund's message: plain lines become paragraphs, "- " lines become a list. */
function Message({ text }: { text: string }) {
  const blocks: Array<{ kind: "p"; text: string } | { kind: "ul"; items: string[] }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-•*]\s+(.*)$/.exec(line)?.[1];
    const last = blocks[blocks.length - 1];
    if (item !== undefined) {
      if (last?.kind === "ul") last.items.push(item);
      else blocks.push({ kind: "ul", items: [item] });
    } else blocks.push({ kind: "p", text: line });
  }
  return (
    <div className="mt-2 space-y-2 leading-relaxed text-foreground">
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>{b.text}</p>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-warning">
            {b.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export default async function StatusPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; sent?: string }> }) {
  const { token } = await params;
  const { lang: langParam, sent } = await searchParams;
  const c = await lookup(token);
  const lang = normalizeLang(langParam ?? c?.lang);
  const t = MESSAGES[lang];
  const s = t.status_page;

  if (!c) {
    return (
      <Shell lang={lang} token={token}>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">{s.title}</h1>
        <p className="leading-relaxed text-muted-foreground">{s.notFound}</p>
      </Shell>
    );
  }

  const amount = amountForCase(c);
  // The payout record dates the "Sent through PayPal" step.
  const payout = c.status === "paying" || c.status === "paid" ? await getPayout(c.id) : undefined;
  const paid = c.status === "paid" && amount !== null;
  // PayPal accepted the payout but the email has no PayPal account: it waits there, and the page says so
  // instead of "keep an eye on your PayPal account".
  const unclaimed = c.status === "paying" && payout?.status === "UNCLAIMED";
  const showAmount = ["approved", "parked", "paying"].includes(c.status) && amount !== null;
  const tone = STATUS_TONE[c.status] ?? "wait";
  const received = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium" }).format(c.timestamps.created.toDate());
  const rejected = c.status === "rejected";
  const current = CURRENT_STEP[c.status];
  const doneBefore = c.status === "paid" ? TIMELINE.length : rejected ? 2 : current ? TIMELINE.indexOf(current) : 1;
  const minutesToCash = c.timestamps.paid ? (c.timestamps.paid.toMillis() - c.timestamps.created.toMillis()) / 60_000 : null;

  return (
    <Shell lang={lang} token={token}>
      {/* A volunteer takes minutes, not seconds, so a case with one is checked less often. */}
      <AutoRefresh active={MOVING.includes(c.status)} everyMs={c.status === "needs_review" ? 15_000 : 5_000} />
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

      <section
        aria-labelledby="current"
        aria-live="polite"
        className={cn("rounded-2xl border p-5 sm:p-6", paid ? "animate-relay-in border-success/25 bg-success-soft" : "border-border bg-card")}
      >
        <div className="flex items-start gap-4">
          {paid ? (
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-success text-background">
              <CircleCheck className="size-6" />
            </span>
          ) : (
            <span aria-hidden="true" className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}>
              <span className="size-2.5 rounded-full bg-current" />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="current" className={cn("font-semibold tracking-tight", paid ? "text-2xl" : "text-xl")}>
              {paid ? s.paidTitle.replace("{amount}", moneyWhole(amount)) : t.status[c.status]}
            </h2>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {paid && minutesToCash !== null ? s.paidHint.replace("{duration}", duration(minutesToCash)) : unclaimed ? s.unclaimedHint : t.statusHint[c.status]}
            </p>
          </div>
        </div>
        {(showAmount || c.payoutBatchId) && (
          <dl className={cn("mt-5 space-y-2 border-t pt-5", paid ? "border-success/20" : "border-border")}>
            {showAmount && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-muted-foreground">{s.amount}</dt>
                <dd className="text-3xl font-semibold tracking-[-0.02em] tabular-nums">{moneyWhole(amount)}</dd>
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

      {/* The fund's question, only while it is waiting for the answer. */}
      {c.applicantMessage && c.status === "needs_info" && (
        <section aria-labelledby="msg" className="rounded-2xl bg-warning-soft p-5">
          <h2 id="msg" className="flex items-center gap-2 text-sm font-semibold text-warning">
            <MessageSquare aria-hidden="true" className="size-4" />
            {s.message}
          </h2>
          <Message text={c.applicantMessage.text} />
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
            const done = i < doneBefore;
            const isCurrent = !rejected && i === doneBefore && current === st;
            const struck = rejected && i >= doneBefore;
            const at = done ? stepTime(c, st, payout) : undefined;
            return (
              <li key={st} aria-current={isCurrent ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0">
                {i < TIMELINE.length - 1 && <span aria-hidden="true" className={`absolute top-7 bottom-1 left-[11px] w-px ${done ? "bg-primary" : "bg-border"}`} />}
                <span
                  aria-hidden="true"
                  className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${
                    done ? "bg-primary text-primary-foreground" : isCurrent ? "border-2 border-primary bg-card" : "border border-input/50 bg-card"
                  }`}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : isCurrent ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pt-0.5">
                  <span
                    className={cn(
                      "text-sm",
                      isCurrent ? "font-medium text-primary" : done ? "" : "text-muted-foreground",
                      struck && "line-through decoration-muted-foreground",
                    )}
                  >
                    {isCurrent ? (s.stepNow[c.status] ?? s.steps[st]) : s.steps[st]}
                  </span>
                  {at && <StepTime iso={at} lang={lang} />}
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
