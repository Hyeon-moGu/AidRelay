import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { DonateForm } from "./donate-form";

export const metadata: Metadata = { title: "Donate · AidRelay" };
export const dynamic = "force-dynamic";

const PROMISES = [
  "Shows up on the public ledger within seconds, with its PayPal capture id.",
  "Pays approved households that are waiting for funds, right away and in policy order.",
  "Your email never appears anywhere public. The fund keeps a one-way reference only.",
];

export default function DonatePage() {
  // The client id is public; read at request time on the server so the Docker image needs no build-time env.
  // The secret never leaves lib/paypal/* on the server.
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1fr_440px] lg:gap-16">
        <div className="space-y-6">
          <p className="text-sm font-medium text-primary">Donate</p>
          <h1 className="max-w-[18ch] text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-4xl">Fund the next grant, and watch it land.</h1>
          <p className="max-w-[56ch] text-lg leading-relaxed text-muted-foreground">
            Donations are captured through PayPal and recorded on the{" "}
            <Link href="/ledger" className="font-medium text-primary hover:underline">
              public ledger
            </Link>
            . The Case Officer turns them into grants for households the policy has already approved.
          </p>
          <ul className="space-y-3">
            {PROMISES.map((p) => (
              <li key={p} className="flex gap-3 text-[15px] leading-relaxed">
                <span aria-hidden="true" className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <p className="max-w-[56ch] rounded-xl bg-muted p-4 text-[13px] leading-relaxed text-muted-foreground">
            Sandbox only. Sign in to PayPal with the sandbox donor account listed in the README. No real money moves.
          </p>
        </div>
        <DonateForm clientId={clientId} />
      </main>
      <SiteFooter />
    </div>
  );
}
