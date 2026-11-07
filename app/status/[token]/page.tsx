// The applicant's status page: reachable only by the unguessable token, no login (docs: "status link").
import type { Metadata } from "next";
import { getCaseByToken } from "@/lib/db/repos/cases";
import { MESSAGES, normalizeLang, TIMELINE } from "@/lib/i18n/messages";
import { formatMoney } from "@/lib/money";
import { amountForCase } from "@/lib/agent/tools";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Your application · AidRelay" };
export const dynamic = "force-dynamic";

export default async function StatusPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; sent?: string }> }) {
  const { token } = await params;
  const { lang: langParam, sent } = await searchParams;
  const c = /^[0-9a-f]{32}$/.test(token) ? await getCaseByToken(token) : undefined;
  const lang = normalizeLang(langParam ?? c?.lang);
  const t = MESSAGES[lang];
  const s = t.status_page;

  if (!c) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">{s.notFound}</p>
      </main>
    );
  }

  const reached = TIMELINE.indexOf(c.status === "needs_info" || c.status === "needs_review" || c.status === "parked" ? "evaluating" : c.status);
  const amount = amountForCase(c);
  const showAmount = ["approved", "parked", "paying", "paid"].includes(c.status) && amount !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-zinc-500">
          {s.caseLabel} <span className="font-mono">{c.id}</span> · {s.received} {c.timestamps.created.toDate().toLocaleDateString(lang === "es" ? "es-US" : "en-US")}
        </p>
      </header>

      <section className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-lg font-semibold">{t.status[c.status]}</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.statusHint[c.status]}</p>
        {showAmount && (
          <p className="mt-3 text-sm">
            {s.amount}: <strong>{formatMoney(amount)}</strong>
          </p>
        )}
        {c.payoutBatchId && (
          <p className="mt-1 text-sm">
            {s.batch}: <span className="font-mono">{c.payoutBatchId}</span>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-500">{s.timeline}</h2>
        <ol className="flex flex-wrap gap-2 text-xs">
          {TIMELINE.map((st, i) => (
            <li
              key={st}
              className={`rounded-full border px-3 py-1 ${i <= reached ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-zinc-300 text-zinc-400 dark:border-zinc-700"} ${c.status === "rejected" && st !== "new" ? "line-through" : ""}`}
            >
              {t.status[st]}
            </li>
          ))}
        </ol>
      </section>

      {c.applicantMessage && (
        <section className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm whitespace-pre-line dark:border-amber-700 dark:bg-amber-950">
          <h2 className="mb-1 font-medium">{s.message}</h2>
          {c.applicantMessage.text}
        </section>
      )}

      {c.status === "needs_info" && !sent && <ReplyForm token={token} lang={lang} />}
      {sent && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-700 dark:bg-emerald-950">{s.replySent}</p>}

      <p className="text-xs text-zinc-500">{s.keepLink}</p>
    </main>
  );
}
