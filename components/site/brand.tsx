import Link from "next/link";
import { cn } from "cn";

/** The mark: two linked rings, a hand-off. Pure SVG in the theme colors. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="6.5" className="fill-primary" />
      <circle cx="9.5" cy="12" r="4.25" fill="none" strokeWidth="2" className="stroke-primary-foreground" />
      <circle cx="14.5" cy="12" r="4.25" fill="none" strokeWidth="2" className="stroke-primary-foreground" opacity="0.7" />
    </svg>
  );
}

export function Brand({ href = "/", suffix }: { href?: string; suffix?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight" translate="no">
      <BrandMark />
      <span>AidRelay</span>
      {suffix && <span className="font-normal text-muted-foreground">{suffix}</span>}
    </Link>
  );
}
