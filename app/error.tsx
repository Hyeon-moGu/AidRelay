"use client";

// Shown when a page fails to render (for example the database does not answer), instead of an empty 500.
// Applicants reach their status page in English or Spanish, so the message is in both.
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">This page could not load</h1>
      <p className="leading-relaxed text-muted-foreground">The fund’s records did not answer in time. Nothing was lost. Please try again in a minute.</p>
      <p lang="es" className="leading-relaxed text-muted-foreground">
        No pudimos cargar esta página. No se perdió nada. Inténtelo de nuevo en un minuto.
      </p>
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
