import Link from "next/link";
import { cn } from "cn";

/**
 * The mark: two chevrons moving forward, a relay hand-off. The same drawing as app/icon.svg, in the theme
 * colors so it follows light and dark mode.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="1024" height="1024" rx="225.28" className="fill-primary" />
      <g fill="none" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground">
        <path d="M 256 352 L 448 512 L 256 672" />
        <path d="M 576 352 L 768 512 L 576 672" />
      </g>
    </svg>
  );
}

export function Brand({ href = "/", suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight" translate="no">
      <BrandMark />
      <span>AidRelay</span>
      {suffix && <span className="hidden font-normal text-muted-foreground sm:inline">{suffix}</span>}
    </Link>
  );
}
