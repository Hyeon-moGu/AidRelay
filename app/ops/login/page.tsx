import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOperator } from "@/lib/ops/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Operator sign-in · AidRelay" };
export const dynamic = "force-dynamic";

export default async function OpsLoginPage() {
  if (await isOperator()) redirect("/ops");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <header className="space-y-1">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">AidRelay</p>
        <h1 className="text-2xl font-semibold">Operator console</h1>
        <p className="text-sm text-zinc-500">Volunteers supervise the Case Officer here. The password is in the fund&apos;s testing instructions.</p>
      </header>
      <LoginForm />
    </main>
  );
}
