import Link from "next/link";

const links = [
  { href: "/ledger", label: "Public ledger", note: "Every dollar in and out, no PII" },
  { href: "/apply", label: "Apply for assistance", note: "3 screens, English / Español" },
  { href: "/donate", label: "Donate", note: "PayPal sandbox" },
  { href: "/ops", label: "Operator console", note: "Supervise the Case Officer" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
          Cash in a survivor&apos;s hands in minutes, not weeks.
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          An autonomous case officer for community disaster-relief funds. Donations come in through
          PayPal; the agent verifies each application against the fund&apos;s published policy, pays
          approved households through PayPal Payouts, and records every dollar on a public ledger.
        </p>
      </header>
      <nav className="grid gap-3 sm:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg border border-zinc-200 p-4 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <span className="block font-medium">{l.label}</span>
            <span className="block text-sm text-zinc-500">{l.note}</span>
          </Link>
        ))}
      </nav>
      <p className="text-xs text-zinc-500">
        Sandbox only. Built for the PayPal AI Hackathon (Devpost, Nov 2026). MIT licensed.
      </p>
    </main>
  );
}
