"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ACCENT } from "./primitives";

/**
 * Casca comum dos formulários do painel: cabeçalho com faixa de destaque,
 * corpo rolável e rodapé fixo com as ações. Cada tela continua dona da sua
 * própria lógica de validação e envio.
 */
export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const maxWidth = {
    sm: "sm:max-w-[480px]",
    md: "sm:max-w-[620px]",
    lg: "sm:max-w-[860px]",
  }[size];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl border border-border/60 p-0 shadow-2xl",
          maxWidth,
        )}
      >
        <div
          className="border-b px-6 py-5"
          style={{
            borderColor: `${ACCENT}1a`,
            backgroundColor: `${ACCENT}0a`,
          }}
        >
          <DialogHeader className="gap-1">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="text-sm text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        </div>

        <div className="unipass-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border/60 bg-background/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
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
}: {
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl px-4 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
}: {
  onClick?: () => void;
  busy?: boolean;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: ACCENT }}
    >
      {busy && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
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
  "h-10 w-full rounded-xl border border-border/70 bg-background px-3 text-sm outline-none transition focus:border-[color:var(--field-accent)]";

export const fieldAccentStyle = {
  "--field-accent": `${ACCENT}66`,
} as React.CSSProperties;
