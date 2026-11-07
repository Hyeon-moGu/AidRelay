// Day 1 placeholder: fund totals and captured donations straight from Firestore.
// Day 3 replaces this with the AG Studio report (per-case rows, median time-to-cash, published policy).
import type { Metadata } from "next";
import Link from "next/link";
import { listRecentDonations } from "@/lib/db/repos/donations";
import { getFund } from "@/lib/db/repos/fund";
import { fundBalanceCents, type DonationDoc, type FundDoc } from "@/lib/db/types";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Public ledger · AidRelay" };
export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  let fund: FundDoc | undefined;
  let donations: DonationDoc[] = [];
  let error: string | undefined;
  try {
    fund = await getFund();
    donations = await listRecentDonations(20);
  } catch (err) {
    console.error("[ledger] could not load the fund", err);
    error = "the fund's records could not be loaded (see the server log)";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-3xl font-semibold">Public ledger</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every dollar in and out of the fund, with its PayPal record id. No names, no addresses.
        </p>
      </header>

      {error ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          The ledger is temporarily unavailable: {error}
        </p>
      ) : fund ? (
        <>
          <section className="grid gap-3 sm:grid-cols-4">
            <Stat label="Raised" value={formatMoney(fund.raisedCents, fund.currency)} />
            <Stat label="Paid out" value={formatMoney(fund.paidCents, fund.currency)} />
            <Stat label="Reserved" value={formatMoney(fund.reservedCents, fund.currency)} />
            <Stat label="Available" value={formatMoney(fundBalanceCents(fund), fund.currency)} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Donations</h2>
            {donations.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No donations yet.{" "}
                <Link href="/donate" className="underline">
                  Make the first one
                </Link>
                .
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-zinc-500">
                  <tr>
                    <th className="py-1 font-medium">When</th>
                    <th className="py-1 font-medium">Amount</th>
                    <th className="py-1 font-medium">PayPal capture</th>
                  </tr>
                </thead>
                <tbody>
                  {donations.map((d) => (
                    <tr key={d.orderId} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-1">{d.capturedAt?.toDate().toISOString().replace("T", " ").slice(0, 16)}</td>
                      <td className="py-1">{formatMoney(d.amountCents, d.currency)}</td>
                      <td className="py-1 font-mono">{d.captureId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}

      <p className="text-xs text-zinc-500">
        Policy: <code>policy.md</code> (published here on Day 3). Sandbox only.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
