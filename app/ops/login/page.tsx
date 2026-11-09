import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/site/brand";
import { getEnv } from "@/lib/env";
import { isOperator } from "@/lib/ops/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign-in · AidRelay" };
export const dynamic = "force-dynamic";

export default async function OpsLoginPage() {
  if (await isOperator()) redirect("/ops");
  const openToLook = getEnv().OPS_PUBLIC_VIEW;
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <Brand />
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">Staff console</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Volunteers supervise the Case Officer here. The password is in the fund’s testing instructions.
          {openToLook && " You need it to approve, reject, send payouts and ask the ledger."}
        </p>
        <LoginForm />
        {openToLook && (
          <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
            Just looking?{" "}
            <Link href="/ops" className="font-medium text-foreground underline underline-offset-2">
              Open the console without signing in
            </Link>
            .
          </p>
        )}
      </div>
    </main>
  );
}
