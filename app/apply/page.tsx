import type { Metadata } from "next";
import { POLICY } from "@/lib/agent/policy";
import { demoPrefill } from "@/lib/demo-prefill";
import { MESSAGES, normalizeLang } from "@/lib/i18n/messages";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

type Search = Promise<{ demo?: string; lang?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const { demo, lang } = await searchParams;
  return { title: `${MESSAGES[normalizeLang(lang ?? demoPrefill(demo)?.lang)].apply.metaTitle} · AidRelay` };
}

export default async function ApplyPage({ searchParams }: { searchParams: Search }) {
  const { demo, lang } = await searchParams;
  const prefill = demoPrefill(demo);
  return (
    <div className="min-h-dvh">
      <ApplyForm initialLang={normalizeLang(lang ?? prefill?.lang)} prefill={prefill} largeHouseholdFrom={POLICY.household.beyond} />
    </div>
  );
}
