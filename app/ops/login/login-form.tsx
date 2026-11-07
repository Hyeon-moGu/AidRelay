"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError("Enter the operator password.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/ops/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "That password did not work. Check the testing instructions and try again.");
      router.replace("/ops");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="mt-6 space-y-4">
      <Field id="ops-password" label="Password" error={error}>
        {(aria) => (
          <Input
            {...aria}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(undefined);
            }}
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
