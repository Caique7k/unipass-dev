"use client";

import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ACCENT } from "./primitives";

const sizeClasses = {
  sm: "sm:max-w-[460px]",
  md: "sm:max-w-[620px]",
  lg: "sm:max-w-[820px]",
  xl: "sm:max-w-[980px]",
} as const;

/**
 * Casca comum dos formulários do painel.
 *
 * Estrutura fixa: cabeçalho com ícone e fecho, corpo rolável e rodapé grudado
 * embaixo. Cada tela continua dona da própria validação e do próprio envio —
 * aqui só mora a moldura.
 */
export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  /** Faixa de apoio no topo do corpo (ex.: aviso de domínio de e-mail). */
  banner,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof sizeClasses;
  banner?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-3xl border border-border/60 bg-card p-0 shadow-2xl",
          // A linha clara no topo é o mesmo detalhe dos painéis da listagem.
          "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px",
          "before:bg-gradient-to-r before:from-transparent before:via-foreground/15 before:to-transparent",
          sizeClasses[size],
        )}
      >
        <div className="relative flex items-start gap-3 border-b border-border/60 px-5 py-4 sm:px-6">
          {icon && (
            <span
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
              style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
            >
              {icon}
            </span>
          )}

          <DialogHeader className="min-w-0 flex-1 gap-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>

          <DialogClose
            aria-label="Fechar"
            className="-mr-1 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X size={15} />
          </DialogClose>
        </div>

        {banner && (
          <div className="border-b border-border/60 px-5 py-3 sm:px-6">
            {banner}
          </div>
        )}

        <div className="unipass-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border/60 bg-background/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ModalCancelButton({
  onClick,
  children = "Cancelar",
  disabled = false,
}: {
  onClick: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-border/60 px-4 text-sm text-muted-foreground transition hover:border-foreground/20 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function ModalSubmitButton({
  onClick,
  busy = false,
  disabled = false,
  children,
  type = "button",
  tone = "accent",
}: {
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
  tone?: "accent" | "danger";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-sm font-medium text-white transition",
        "hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
      )}
      style={{ backgroundColor: tone === "danger" ? "#dc2626" : ACCENT }}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/** Seção dentro do formulário, para separar blocos de campos. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || description) && (
        <div>
          {title && (
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </h3>
          )}
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Campo de formulário com rótulo, dica e mensagem de erro. */
export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex items-center gap-1 text-sm font-medium">
        {label}
        {required && <span style={{ color: ACCENT }}>*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export const fieldInputClass =
  "h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-[color:var(--field-accent)]";

export const fieldAccentStyle = {
  "--field-accent": `${ACCENT}66`,
} as React.CSSProperties;
