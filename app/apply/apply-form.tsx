"use client";

// Three screens: contact, what happened, photos + review. English / Spanish. Posts multipart to /api/apply
// and sends the applicant to their status link. Built for a phone first: 44px targets, 16px inputs,
// inline errors with focus on the first one.
import { Camera, FileText, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/site/brand";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import type { Prefill } from "@/lib/demo-prefill";
import { MESSAGES, type Lang } from "@/lib/i18n/messages";
import { fileTypeProblem, MAX_FILE_BYTES, MAX_PHOTOS } from "@/lib/upload-rules";

type Fields = Omit<Prefill, "lang">;
type ErrorKey = keyof Fields | "photos" | "form";

const EMPTY: Fields = { name: "", email: "", phone: "", address: "", zip: "", householdSize: "", requestedAmountDollars: "", narrative: "" };

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ApplyForm({ initialLang, prefill, largeHouseholdFrom }: { initialLang: Lang; prefill?: Prefill; largeHouseholdFrom: number }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [step, setStepRaw] = useState(0);
  const [moved, setMoved] = useState(false);
  const setStep = (n: number) => {
    setMoved(true);
    setStepRaw(n);
  };
  const [f, setF] = useState<Fields>(prefill ? { ...EMPTY, ...prefill } : EMPTY);
  const [photos, setPhotos] = useState<File[]>([]);
  const [doc, setDoc] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const t = MESSAGES[lang];
  const a = t.apply;

  const previews = useMemo(() => photos.map((p) => ({ file: p, url: URL.createObjectURL(p) })), [photos]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: e.target.value });
    if (errors[k]) setErrors({ ...errors, [k]: undefined });
  };

  function validateStep(s: number): boolean {
    const e: typeof errors = {};
    if (s === 0) {
      if (!f.name.trim()) e.name = a.errors.required;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = a.errors.email;
      if (!/^\d{5}(-\d{4})?$/.test(f.zip.trim())) e.zip = a.errors.zip;
      // P-5: without a household size the case would come back as needs_info, costing the family a round trip.
      if (!/^\d{1,2}$/.test(f.householdSize.trim()) || Number(f.householdSize) < 1) e.householdSize = a.errors.household;
    }
    if (s === 1 && f.narrative.trim().length < 10) e.narrative = a.errors.required;
    if (s === 2) {
      if (photos.length === 0) e.photos = a.errors.photos;
      if ([...photos, ...(doc ? [doc] : [])].some((x) => x.size > MAX_FILE_BYTES)) e.photos = a.errors.tooLarge;
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return false;
    }
    return true;
  }

  async function submit() {
    if (!validateStep(2)) return;
    setBusy(true);
    setErrors({});
    try {
      const body = new FormData();
      body.set("lang", lang);
      for (const [k, v] of Object.entries(f)) body.set(k, v.trim());
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (step < 2) {
      if (validateStep(step)) setStep(step + 1);
    } else void submit();
  }

  /**
   * The files the server can read. One it cannot (an iPhone HEIC photo, or not an image) is left out and
   * named in the error straight away, before a slow upload that would be refused.
   */
  function readable(picked: File[]): File[] {
    const bad = picked.find((x) => fileTypeProblem(x));
    setErrors((prev) => ({ ...prev, photos: bad ? a.errors.fileType.replace("{name}", bad.name) : undefined }));
    return picked.filter((x) => !fileTypeProblem(x));
  }

  function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = readable(Array.from(e.target.files ?? []));
    e.target.value = "";
    setPhotos((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
  }

  function addDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = readable(Array.from(e.target.files ?? []));
    e.target.value = "";
    setDoc(picked[0] ?? null);
  }

  const text = (k: keyof Fields, label: string, opts: { hint?: string; optional?: boolean; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string; placeholder?: string } = {}) => (
    <Field id={`f-${k}`} label={label} optional={opts.optional ? a.optional : undefined} hint={opts.hint} error={errors[k]}>
      {(aria) => (
        <Input
          {...aria}
          name={k}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          autoComplete={opts.autoComplete ?? "off"}
          placeholder={opts.placeholder}
          spellCheck={opts.type === "email" ? false : undefined}
          autoCapitalize={opts.type === "email" ? "none" : undefined}
          value={f[k]}
          onChange={set(k)}
        />
      )}
    </Field>
  );

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6">
      <div className="flex h-14 items-center justify-between pt-[env(safe-area-inset-top)]">
        <Brand />
        <div role="group" aria-label={a.language} className="flex rounded-lg bg-muted p-0.5 text-[13px]">
          {(["en", "es"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              lang={l}
              onClick={() => setLang(l)}
              className={`relative rounded-md px-2.5 py-1.5 font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${lang === l ? "bg-card text-foreground shadow-[0_1px_2px_rgba(20,24,28,0.08)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>

      <main id="main">
        <header className="mt-6 space-y-3">
          <p className="text-sm font-medium text-primary tabular-nums">{a.stepOf.replace("{n}", String(step + 1)).replace("{total}", "3")}</p>
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em]">{a.title}</h1>
          {step === 0 && <p className="leading-relaxed text-muted-foreground">{a.intro}</p>}
          <ol className="grid grid-cols-3 gap-2 pt-2">
            {a.steps.map((s, i) => (
              <li key={s} aria-current={i === step ? "step" : undefined} className="space-y-1.5">
                <span aria-hidden="true" className={`block h-1 rounded-full transition-colors duration-200 ${i <= step ? "bg-primary" : "bg-border"}`} />
                <span className={`block text-xs ${i === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </header>

        <form noValidate onSubmit={onSubmit} className="mt-6">
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
              {a.cardTitles[step]}
            </h2>

            <div key={step} className={`mt-5 space-y-5 ${moved ? "animate-relay-in" : ""}`}>
              {step === 0 && (
                <>
                  {text("name", a.name, { autoComplete: "name", placeholder: "Maria Lopez" })}
                  {text("email", a.email, { hint: a.emailHint, type: "email", inputMode: "email", autoComplete: "email", placeholder: "name@example.com" })}
                  {text("phone", a.phone, { optional: true, type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "(252) 555-0134" })}
                  {text("address", a.address, { optional: true, autoComplete: "street-address", placeholder: "412 Mill St" })}
                  <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
                    {text("zip", a.zip, { inputMode: "numeric", autoComplete: "postal-code", placeholder: "28501" })}
                    {text("householdSize", a.householdSize, { inputMode: "numeric", hint: a.householdHint.replace("{n}", String(largeHouseholdFrom)) })}
                  </div>
                </>
              )}

              {step === 1 && (
                <>
                  <Field id="f-narrative" label={a.narrative} hint={a.narrativeHint} hintFirst error={errors.narrative}>
                    {(aria) => <Textarea {...aria} name="narrative" rows={7} value={f.narrative} onChange={set("narrative")} />}
                  </Field>
                  {text("requestedAmountDollars", a.requestedAmount, { optional: true, inputMode: "decimal", placeholder: "600", hint: a.requestedAmountHint })}
                </>
              )}

              {step === 2 && (
                <>
                  <div className="space-y-2">
                    <p id="photos-label" className="text-sm font-medium">
                      {a.photos}
                    </p>
                    {photos.length < MAX_PHOTOS && (
                      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-input/70 bg-muted/50 px-4 py-6 text-center transition-colors hover:border-primary hover:bg-accent/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                        <Camera aria-hidden="true" className="size-6 text-primary" />
                        <span className="font-medium text-primary">{a.addPhotos}</span>
                        <span className="text-[13px] text-muted-foreground">{a.photosHint}</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={addPhotos}
                          className="sr-only"
                          aria-labelledby="photos-label"
                          aria-invalid={errors.photos ? true : undefined}
                          aria-describedby={errors.photos ? "photos-error" : undefined}
                        />
                      </label>
                    )}
                    {previews.length > 0 && (
                      <ul className="grid grid-cols-3 gap-2">
                        {previews.map((p, i) => (
                          <li key={`${p.file.name}-${i}`} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="" width={160} height={160} className="aspect-square w-full rounded-lg border border-border object-cover" />
                            <button
                              type="button"
                              aria-label={`${a.remove} ${p.file.name}`}
                              onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                              className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-transform after:absolute after:-inset-1.5 after:content-[''] active:scale-[0.94]"
                            >
                              <X aria-hidden="true" className="size-4" />
                            </button>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">{mb(p.file.size)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {errors.photos && (
                      <p id="photos-error" className="text-[13px] font-medium text-danger">
                        {errors.photos}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="flex items-baseline gap-1.5 text-sm font-medium">
                      {a.docs} <span className="text-xs font-normal text-muted-foreground">{a.optional}</span>
                    </p>
                    {doc ? (
                      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
                        <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{mb(doc.size)}</span>
                        <button type="button" aria-label={`${a.remove} ${doc.name}`} onClick={() => setDoc(null)} className="-my-1.5 -mr-2 flex size-11 items-center justify-center rounded-md hover:bg-muted">
                          <X aria-hidden="true" className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-input/60 bg-card px-3 text-sm font-medium transition-colors hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                        <FileText aria-hidden="true" className="size-4 text-primary" />
                        {a.addDocument}
                        <input type="file" accept="image/*" onChange={addDoc} className="sr-only" />
                      </label>
                    )}
                    <p className="text-[13px] text-muted-foreground">{a.docsHint}</p>
                  </div>

                  <div className="rounded-xl bg-muted/60 p-4">
                    <h3 className="text-sm font-medium">{a.reviewTitle}</h3>
                    <dl className="mt-2 divide-y divide-border text-sm">
                      {(
                        [
                          [a.name, f.name, false],
                          [a.email, f.email, true],
                          [a.zip, f.zip, false],
                          [a.householdSize, f.householdSize || "–", false],
                          [a.requestedAmount, f.requestedAmountDollars ? `$${f.requestedAmountDollars}` : "–", false],
                        ] as const
                      ).map(([label, value, noTranslate]) => (
                        <div key={label} className="flex justify-between gap-4 py-1.5">
                          <dt className="shrink-0 text-muted-foreground">{label}</dt>
                          <dd className={`min-w-0 text-right tabular-nums ${noTranslate ? "break-all" : "break-words"}`} translate={noTranslate ? "no" : undefined}>
                            {value}
                          </dd>
                        </div>
                      ))}
                      <div className="space-y-0.5 py-1.5">
                        <dt className="text-muted-foreground">{a.steps[1]}</dt>
                        <dd className="line-clamp-2 leading-relaxed">{f.narrative}</dd>
                      </div>
                    </dl>
                  </div>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{a.consent}</p>
                  {errors.form && (
                    <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
                      {errors.form}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            {step > 0 && (
              <Button type="button" size="lg" variant="outline" disabled={busy} onClick={() => setStep(step - 1)}>
                {a.back}
              </Button>
            )}
            <Button type="submit" size="lg" className="ml-auto min-w-36 flex-1 sm:flex-none" disabled={busy}>
              {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {step === 0 ? a.next : step === 1 ? a.review : busy ? a.submitting : a.submit}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
