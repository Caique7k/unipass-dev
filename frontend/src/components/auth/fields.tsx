"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export const fieldInputClass =
  "h-12 w-full rounded-xl border bg-white px-4 text-sm text-[#111111] outline-none transition placeholder:text-[#111111]/35 focus:border-[#ff5c00] focus:ring-4 focus:ring-[#ff5c00]/10 dark:bg-[#141416] dark:text-[#f4f4f4] dark:placeholder:text-[#f4f4f4]/30";

export const fieldBorderClass = "border-black/15 dark:border-white/15";
export const fieldErrorBorderClass = "border-red-500 dark:border-red-500";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, trailing, leading, className, id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/55 dark:text-[#f4f4f4]/55"
      >
        {label}
      </label>
      <div className="relative">
        {leading && (
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]/40 dark:text-[#f4f4f4]/40">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          className={cn(
            fieldInputClass,
            error ? fieldErrorBorderClass : fieldBorderClass,
            leading && "pl-11",
            trailing && "pr-12",
            className,
          )}
          {...props}
        />
        {trailing && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        )}
      </div>
      <FieldMessage error={error} hint={hint} />
    </div>
  );
});

export function FieldMessage({
  error,
  hint,
}: {
  error?: string;
  hint?: ReactNode;
}) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {error ? (
        <motion.p
          key="error"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </motion.p>
      ) : hint ? (
        <motion.p
          key="hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-xs text-[#111111]/50 dark:text-[#f4f4f4]/50"
        >
          {hint}
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

export const primaryButtonClass =
  "group inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#ff5c00] px-6 text-sm font-semibold text-white transition hover:bg-[#e65300] disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-black/15 px-6 text-sm font-semibold transition hover:border-black/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:hover:border-white/50";

export function Spinner() {
  return (
    <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
