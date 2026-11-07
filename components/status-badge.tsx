import { cn } from "cn";

export type Tone = "success" | "accent" | "warning" | "danger" | "wait";

/** One meaning per color: green = money delivered, teal = the agent is acting, amber = a human is needed,
 *  red = refused or failed, slate = queued or waiting for funds. */
export const STATUS_TONE: Record<string, Tone> = {
  new: "wait",
  evaluating: "accent",
  needs_info: "warning",
  needs_review: "warning",
  approved: "accent",
  parked: "wait",
  paying: "accent",
  paid: "success",
  rejected: "danger",
};

/** Operator and public wording for each status (the applicant page has its own, translated). */
export const STATUS_LABEL: Record<string, string> = {
  new: "new",
  evaluating: "evaluating",
  needs_info: "needs info",
  needs_review: "needs review",
  approved: "approved",
  parked: "waiting for funds",
  paying: "paying",
  paid: "paid",
  rejected: "rejected",
};

export const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  accent: "bg-accent text-accent-foreground",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  wait: "bg-wait-soft text-wait",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? "wait";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CLASS[tone], className)}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Chip({ tone = "wait", mono, className, children }: { tone?: Tone; mono?: boolean; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", mono && "font-mono", TONE_CLASS[tone], className)}>{children}</span>;
}
