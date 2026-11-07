import type { Metadata } from "next";
import { demoPrefill } from "@/lib/demo-prefill";
import { normalizeLang } from "@/lib/i18n/messages";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Apply · AidRelay" };
export const dynamic = "force-dynamic";

export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ demo?: string; lang?: string }> }) {
  const { demo, lang } = await searchParams;
  const prefill = demoPrefill(demo);
  return (
    <div className="min-h-dvh">
      <ApplyForm initialLang={normalizeLang(lang ?? prefill?.lang)} prefill={prefill} />
    </div>
  );
}
