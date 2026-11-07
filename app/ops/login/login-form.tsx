"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/ops/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const json = (await res.json()) as { ok: boolean; error?: string };
    if (json.ok) {
      router.replace("/ops");
      router.refresh();
    } else {
      setError(json.error ?? "sign-in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy || !password}>
        Sign in
      </Button>
    </form>
  );
}
