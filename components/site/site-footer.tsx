import Link from "next/link";
import { BrandMark } from "./brand";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-center gap-2">
          <BrandMark className="size-4" />
          <span>
            <span translate="no">AidRelay</span> runs on the PayPal sandbox. No real money moves.
          </span>
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/ledger#policy" className="hover:text-foreground">
            Policy
          </Link>
          <Link href="/api/ledger" className="hover:text-foreground">
            Ledger API
          </Link>
          <Link href="/ops" className="hover:text-foreground">
            Operators
          </Link>
          <a href="https://github.com/Hyeon-moGu/AidRelay" className="hover:text-foreground">
            Source, MIT
          </a>
        </nav>
      </div>
    </footer>
  );
}
