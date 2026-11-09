"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Brand } from "./brand";

// `from` hides a link below that width: on phones the header has room for two links and the Donate button only.
const NAV: Array<{ href: string; label: string; from?: "sm" | "md" }> = [
  { href: "/ledger", label: "Ledger" },
  { href: "/policy", label: "How it decides", from: "sm" },
  { href: "/apply", label: "Get help" },
  // Where volunteers supervise the agent. Open to look at in the demo; on phones the landing page and the footer link to it.
  { href: "/ops", label: "Staff console", from: "md" },
];

// The links stay compact but their tap area reaches 44px tall.
const tapArea = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Brand />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  tapArea,
                  "rounded-md px-2 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-2.5",
                  active && "text-foreground",
                  n.from === "sm" && "hidden sm:inline-flex",
                  n.from === "md" && "hidden md:inline-flex",
                )}
              >
                {n.label}
              </Link>
            );
          })}
          <Link
            href="/donate"
            aria-current={path === "/donate" ? "page" : undefined}
            className={cn(
              tapArea,
              "ml-0.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97] sm:ml-1 sm:px-3",
            )}
          >
            Donate
          </Link>
        </nav>
      </div>
    </header>
  );
}
