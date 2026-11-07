"use client";

// Three screens: contact, what happened, photos + review. English / Spanish. Posts multipart to /api/apply
// and sends the applicant to their status link.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Prefill } from "@/lib/demo-prefill";
import { MESSAGES, type Lang } from "@/lib/i18n/messages";

const MAX_PHOTOS = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Fields = Omit<Prefill, "lang">;

const EMPTY: Fields = { name: "", email: "", phone: "", address: "", zip: "", householdSize: "", requestedAmountDollars: "", narrative: "" };

export function ApplyForm({ initialLang, prefill }: { initialLang: Lang; prefill?: Prefill }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [step, setStep] = useState(0);
  const [f, setF] = useState<Fields>(prefill ? { ...EMPTY, ...prefill } : EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [doc, setDoc] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields | "photos" | "form", string>>>({});
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const t = MESSAGES[lang];
  const a = t.apply;

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  function validateStep(s: number): boolean {
    const e: typeof errors = {};
    if (s === 0) {
      if (!f.name.trim()) e.name = a.errors.required;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = a.errors.email;
      if (!/^\d{5}(-\d{4})?$/.test(f.zip.trim())) e.zip = a.errors.zip;
    }
    if (s === 1) {
      if (f.narrative.trim().length < 10) e.narrative = a.errors.required;
    }
    if (s === 2) {
      if (photos.length === 0) e.photos = a.errors.photos;
      if ([...photos, ...(doc ? [doc] : [])].some((x) => x.size > MAX_FILE_BYTES)) e.photos = a.errors.tooLarge;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit() {
    if (!validateStep(2)) return;
    setBusy(true);
    setErrors({});
    try {
      const body = new FormData();
      body.set("lang", lang);
      for (const [k, v] of Object.entries(f)) body.set(k, v);
      for (const p of photos) body.append("photos", p);
      if (doc) body.append("docs", doc);
      const res = await fetch("/api/apply", { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; data?: { token: string }; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error ?? a.errors.failed);
      router.push(`/status/${json.data.token}?lang=${lang}`);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : a.errors.failed });
      setBusy(false);
    }
  }

  const field = (k: keyof Fields, label: string, opts: { hint?: string; optional?: boolean; type?: string; inputMode?: "numeric" | "decimal" | "email" | "tel" } = {}) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium">
        {label}
        {opts.optional && <span className="ml-1 text-xs text-zinc-500">({a.optional})</span>}
      </span>
      <input
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        value={f[k]}
        onChange={set(k)}
        className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
      />
      {opts.hint && <span className="block text-xs text-zinc-500">{opts.hint}</span>}
      {errors[k] && <span className="block text-xs text-red-600">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
          <div className="flex gap-1 text-sm">
            {(["en", "es"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`rounded px-2 py-1 ${lang === l ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500"}`}
              >
                {l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </div>
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.intro}</p>
        <ol className="flex gap-3 text-xs">
          {a.steps.map((s, i) => (
            <li key={s} className={i === step ? "font-semibold" : "text-zinc-500"}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <section className="space-y-4">
          {field("name", a.name)}
          {field("email", a.email, { hint: a.emailHint, type: "email", inputMode: "email" })}
          {field("phone", a.phone, { optional: true, type: "tel", inputMode: "tel" })}
          {field("address", a.address, { optional: true })}
          <div className="grid grid-cols-2 gap-4">
            {field("zip", a.zip, { inputMode: "numeric" })}
            {field("householdSize", a.householdSize, { optional: true, inputMode: "numeric" })}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{a.narrative}</span>
            <textarea
              value={f.narrative}
              onChange={set("narrative")}
              rows={7}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            />
            <span className="block text-xs text-zinc-500">{a.narrativeHint}</span>
            {errors.narrative && <span className="block text-xs text-red-600">{errors.narrative}</span>}
          </label>
          {field("requestedAmountDollars", a.requestedAmount, { optional: true, inputMode: "decimal" })}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">{a.photos}</span>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))}
              className="block w-full text-sm"
            />
            <span className="block text-xs text-zinc-500">{a.photosHint}</span>
            {photos.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-1">
                {photos.map((p) => (
                  <li key={p.name} className="rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                    {p.name} · {(p.size / 1024 / 1024).toFixed(1)} MB
                  </li>
                ))}
              </ul>
            )}
            {errors.photos && <span className="block text-xs text-red-600">{errors.photos}</span>}
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {a.docs} <span className="text-xs text-zinc-500">({a.optional})</span>
            </span>
            <input type="file" accept="image/*" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            <span className="block text-xs text-zinc-500">{a.docsHint}</span>
          </label>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <dt className="text-zinc-500">{a.name}</dt>
            <dd>{f.name}</dd>
            <dt className="text-zinc-500">{a.email}</dt>
            <dd>{f.email}</dd>
            <dt className="text-zinc-500">{a.zip}</dt>
            <dd>{f.zip}</dd>
            <dt className="text-zinc-500">{a.householdSize}</dt>
            <dd>{f.householdSize || "–"}</dd>
            <dt className="text-zinc-500">{a.requestedAmount}</dt>
            <dd>{f.requestedAmountDollars ? `$${f.requestedAmountDollars}` : "–"}</dd>
          </dl>
          <p className="text-xs text-zinc-500">{a.consent}</p>
          {errors.form && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">{errors.form}</p>}
        </section>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
          {a.back}
        </Button>
        {step < 2 ? (
          <Button type="button" onClick={() => validateStep(step) && setStep(step + 1)}>
            {step === 1 ? a.review : a.next}
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={submit}>
            {busy ? a.submitting : a.submit}
          </Button>
        )}
      </div>
    </div>
  );
}
