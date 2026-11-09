import Link from "next/link";
import { BrandMark } from "./brand";

const LINKS = [
  { href: "/policy", label: "How it decides" },
  { href: "/api/ledger", label: "Ledger data" },
  { href: "/ops", label: "Staff console" },
  { href: "https://github.com/Hyeon-moGu/AidRelay", label: "Source code (MIT)", external: true },
];

// 44px tall on phones, where the links stack two per row; compact text links from sm up.
const linkClass = "inline-flex min-h-11 items-center hover:text-foreground sm:min-h-0";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6">
        <p className="flex items-start gap-2 sm:items-center">
          <BrandMark className="mt-0.5 size-4 sm:mt-0" />
          <span>
            <span translate="no">AidRelay</span> is a PayPal AI Hackathon project running on the PayPal sandbox, so no real money moves. The flood and the
            families are fictional.
          </span>
        </p>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-4 sm:flex sm:shrink-0 sm:flex-wrap sm:gap-y-1">
          {LINKS.map((l) =>
            l.external ? (
              <a key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
