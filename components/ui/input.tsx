import * as React from "react";
import { cn } from "cn";

/** Shared field styling: 44px tall on touch, 16px text on phones (no iOS zoom), teal focus ring. */
export const fieldClass =
  "w-full min-w-0 rounded-lg border border-input/70 bg-card px-3 text-foreground placeholder:text-muted-foreground/80 transition-[border-color,box-shadow] duration-150 ease-out hover:border-input focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/15 disabled:opacity-60";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(fieldClass, "h-11 sm:h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldClass, "py-2.5 leading-relaxed", className)} {...props} />;
}

export interface FieldAria {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** Label + control + hint + inline error, wired with aria-describedby and aria-invalid. */
export function Field({
  id,
  label,
  optional,
  hint,
  hintFirst,
  error,
  children,
}: {
  id: string;
  label: React.ReactNode;
  optional?: string;
  hint?: React.ReactNode;
  /** Show the hint between the label and the control, for prompts the person should read before typing. */
  hintFirst?: boolean;
  error?: string;
  children: (aria: FieldAria) => React.ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-muted-foreground">{optional}</span>}
      </label>
      {hint && hintFirst && (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !hintFirst && (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
