"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT, Panel, SectionLabel, spring } from "./primitives";

/* ------------------------------------------------------------------ header */

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** Pequenos indicadores à direita do título (contadores, status). */
  meta?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div className="min-w-0">
        {eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
            {title}
          </h1>
          {meta}
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </motion.div>
  );
}

/* ----------------------------------------------------------------- toolbar */

export function Toolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("flex flex-wrap items-center gap-3 p-3", className)}>
      {children}
    </Panel>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Buscar...",
  busy = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Mostra o spinner enquanto a busca ainda está em voo. */
  busy?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3",
        "focus-within:border-[color:var(--sf-accent)]",
        className,
      )}
      style={{ "--sf-accent": `${ACCENT}66` } as React.CSSProperties}
    >
      <Search size={14} className="shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {busy && (
        <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />
      )}
      {!busy && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="shrink-0 cursor-pointer text-muted-foreground transition hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** Grupo de filtros mutuamente exclusivos, com pílula animada. */
export function FilterChips<T extends string>({
  value,
  onChange,
  options,
  layoutId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  /** Precisa ser único por tela quando há mais de um grupo. */
  layoutId: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative cursor-pointer rounded-full px-3 py-1.5 text-xs transition",
              active
                ? "text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-foreground"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">
              {option.label}
              {option.count !== undefined && (
                <span className="ml-1.5 tabular-nums opacity-70">
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PrimaryButton({
  children,
  className,
  ...rest
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-white",
        "transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ backgroundColor: ACCENT }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  tone = "default",
  ...rest
}: React.ComponentProps<"button"> & { tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm transition",
        "disabled:cursor-not-allowed disabled:opacity-45",
        tone === "danger"
          ? "border-red-500/40 text-red-500 hover:bg-red-500/10"
          : "border-border/60 hover:border-foreground/25 hover:bg-accent/50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ badges */

const badgeTones = {
  neutral: "border-border/70 text-muted-foreground",
  success:
    "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  warning:
    "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
  danger: "border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10",
  info: "border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10",
  accent: "",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function StatusBadge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        badgeTones[tone],
      )}
      style={
        tone === "accent"
          ? {
              borderColor: `${ACCENT}55`,
              color: ACCENT,
              backgroundColor: `${ACCENT}12`,
            }
          : undefined
      }
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      )}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- feedback  */

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm font-medium">{message}</p>
      {onRetry && (
        <GhostButton onClick={onRetry}>Tentar de novo</GhostButton>
      )}
    </Panel>
  );
}

/** Barra fina de progresso no topo de um painel durante recargas. */
export function FetchingBar({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
      <motion.div
        className="h-full w-1/3 rounded-full"
        style={{ backgroundColor: ACCENT }}
        animate={{ x: ["-100%", "320%"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export { ConfirmDialog } from "./ConfirmDialog";
export { spring };
