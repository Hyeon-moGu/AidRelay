"use client";

import { BotMessageSquare, LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import { Brand } from "./brand";

type Width = "sm" | "md" | "lg";

// `from` hides a link below that width: on phones the header has room for two links and the Donate button only.
// `staffFrom` is the width for the staff console, where the two staff links come first.
const NAV: Array<{ href: string; label: string; from?: Width; staffFrom: Width }> = [
  { href: "/ledger", label: "Ledger", staffFrom: "md" },
  { href: "/policy", label: "How it decides", from: "sm", staffFrom: "lg" },
  { href: "/apply", label: "Get help", staffFrom: "lg" },
  // Where volunteers supervise the agent. Open to look at in the demo; on phones the landing page and the footer link to it.
  { href: "/ops", label: "Staff console", from: "md", staffFrom: "md" },
];

const SHOW_FROM: Record<Width, string> = { sm: "hidden sm:inline-flex", md: "hidden md:inline-flex", lg: "hidden lg:inline-flex" };

// The links stay compact but their tap area reaches 44px tall.
const tapArea = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";
const linkClass = "rounded-md px-2 py-1.5 font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground sm:px-2.5";

/**
 * The one header of the site. On the staff console (`staff` set) it keeps the same links, so a visitor can
 * always get back, and adds the two that belong to staff: Ask the ledger, and Sign in or Sign out.
 */
export function SiteHeader({ staff }: { staff?: "viewer" | "operator" }) {
  const path = usePathname();
  const router = useRouter();
  const onAudit = path.startsWith("/ops/audit");

  async function signOut() {
    await fetch("/api/ops/login", { method: "DELETE" });
    // Stay where they are: the server shows the page view-only while the demo is open, or sends them to the sign-in.
    router.replace(onAudit ? "/ops/audit" : "/ops");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className={cn("mx-auto flex h-14 items-center justify-between gap-2 px-4 sm:gap-4", staff ? "max-w-[1600px]" : "max-w-6xl sm:px-6")}>
        <Brand />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {NAV.map((n) => {
            // Ask the ledger lives under /ops but has its own link, so it does not light up "Staff console".
            const active = n.href === "/ops" ? path === "/ops" || (path.startsWith("/ops/") && !onAudit) : path === n.href || path.startsWith(`${n.href}/`);
            const from = staff ? n.staffFrom : n.from;
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn(tapArea, linkClass, active && "text-foreground", from && SHOW_FROM[from])}>
                {n.label}
              </Link>
            );
          })}
          {staff && (
            <>
              <Link href="/ops/audit" aria-current={onAudit ? "page" : undefined} className={cn(tapArea, linkClass, "inline-flex items-center gap-1.5", onAudit && "text-foreground")}>
                <BotMessageSquare aria-hidden="true" className="size-4 text-primary" />
                Ask the ledger
              </Link>
              {staff === "operator" ? (
                <button type="button" onClick={signOut} className={cn(tapArea, linkClass, "inline-flex items-center gap-1.5")}>
                  <LogOut aria-hidden="true" className="size-4" />
                  Sign out
                </button>
              ) : (
                <Link href="/ops/login" className={cn(tapArea, linkClass, "inline-flex items-center gap-1.5")}>
                  <LogIn aria-hidden="true" className="size-4" />
                  Sign in
                </Link>
              )}
            </>
          )}
          <Link
            href="/donate"
            aria-current={path === "/donate" ? "page" : undefined}
            className={cn(
              tapArea,
              "ml-0.5 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97] sm:ml-1 sm:px-3",
              staff && "hidden sm:inline-flex",
            )}
          >
            Donate
          </Link>
        </nav>
      </div>
    </header>
  );
}
