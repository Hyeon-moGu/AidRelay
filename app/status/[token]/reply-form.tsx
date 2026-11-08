"use client";

import { Camera, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { MESSAGES, type Lang } from "@/lib/i18n/messages";

const MAX_FILES = 3;

export function ReplyForm({ token, lang }: { token: string; lang: Lang }) {
  const router = useRouter();
  const m = MESSAGES[lang];
  const s = m.status_page;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim() && files.length === 0) {
      setError(m.apply.errors.required);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("text", text);
      for (const f of files) body.append("photos", f);
      const res = await fetch(`/api/status/${token}/reply`, { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? m.apply.errors.failed);
      router.push(`/status/${token}?lang=${lang}&sent=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : m.apply.errors.failed);
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} aria-labelledby="reply" className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 id="reply" className="text-lg font-semibold tracking-tight">
        {s.replyTitle}
      </h2>
      <Field id="reply-text" label={s.replyText} error={error}>
        {(aria) => (
          <Textarea
            {...aria}
            name="text"
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(undefined);
            }}
          />
        )}
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">{s.replyPhotos}</p>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <button type="button" aria-label={`${m.apply.remove} ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="-my-1.5 -mr-2 flex size-11 items-center justify-center rounded-md hover:bg-muted">
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < MAX_FILES && (
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-input/60 bg-card px-3 text-sm font-medium transition-colors hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            <Camera aria-hidden="true" className="size-4 text-primary" />
            {m.apply.addPhotos}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = "";
                setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
                if (error) setError(undefined);
              }}
            />
          </label>
        )}
      </div>
      <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
        {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        {s.replySubmit}
      </Button>
    </form>
  );
}
