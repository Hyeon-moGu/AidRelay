import type { Metadata } from "next";
import Link from "next/link";
import { DonateForm } from "./donate-form";

export const metadata: Metadata = { title: "Donate — AidRelay" };

export default function DonatePage() {
  // The client id is public; read at request time on the server so the Docker image needs no build-time env.
  // The secret never leaves lib/paypal/* on the server.
  const clientId = process.env.PAYPAL_CLIENT_ID ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-3xl font-semibold">Donate to the relief fund</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every donation is captured through PayPal and appears on the{" "}
          <Link href="/ledger" className="underline">
            public ledger
          </Link>{" "}
          with its PayPal capture id. When money arrives, the Case Officer immediately pays the
          approved households that were waiting for funds.
        </p>
        <p className="text-xs text-zinc-500">
          Sandbox only: use the sandbox donor account from the README. No real money moves.
        </p>
      </header>
      <DonateForm clientId={clientId} />
    </main>
  );
}
