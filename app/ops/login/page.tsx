import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/site/brand";
import { isOperator } from "@/lib/ops/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Operator sign-in · AidRelay" };
export const dynamic = "force-dynamic";

export default async function OpsLoginPage() {
  if (await isOperator()) redirect("/ops");
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <Brand />
      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <h1 className="text-xl font-semibold tracking-tight">Operator console</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Volunteers supervise the Case Officer here. The password is in the fund’s testing instructions.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
