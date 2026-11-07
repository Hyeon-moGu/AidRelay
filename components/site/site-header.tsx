"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Brand } from "./brand";

const NAV = [
  { href: "/ledger", label: "Ledger" },
  { href: "/apply", label: "Apply" },
];

export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {NAV.map((n) => {
            const active = path === n.href || path.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground", active && "text-foreground")}
              >
                {n.label}
              </Link>
            );
          })}
          <Link
            href="/donate"
            aria-current={path === "/donate" ? "page" : undefined}
            className="ml-1 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97]"
          >
            Donate
          </Link>
        </nav>
      </div>
    </header>
  );
}
