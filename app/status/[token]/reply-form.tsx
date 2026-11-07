"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MESSAGES, type Lang } from "@/lib/i18n/messages";

export function ReplyForm({ token, lang }: { token: string; lang: Lang }) {
  const router = useRouter();
  const s = MESSAGES[lang].status_page;
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.set("text", text);
      for (const f of files) body.append("photos", f);
      const res = await fetch(`/api/status/${token}/reply`, { method: "POST", body });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? MESSAGES[lang].apply.errors.failed);
      router.push(`/status/${token}?lang=${lang}&sent=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : MESSAGES[lang].apply.errors.failed);
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">{s.replyTitle}</h2>
      <label className="block space-y-1 text-sm">
        <span>{s.replyText}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{s.replyPhotos}</span>
        <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))} className="block w-full text-sm" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="button" disabled={busy || (!text.trim() && files.length === 0)} onClick={submit}>
        {s.replySubmit}
      </Button>
    </section>
  );
}
