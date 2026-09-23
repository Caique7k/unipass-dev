"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ACCENT } from "./primitives";

const tones = {
  danger: {
    accent: "#dc2626",
    icon: "bg-red-500/10 text-red-600 dark:text-red-400",
    ring: "#dc262633",
  },
  warning: {
    accent: "#f59e0b",
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    ring: "#f59e0b33",
  },
  accent: {
    accent: ACCENT,
    icon: "",
    ring: `${ACCENT}33`,
  },
} as const;

/**
 * Confirmação de ação destrutiva.
 *
 * O peso visual é proporcional ao estrago: ícone de alerta, faixa listando o
 * que será afetado e botão na cor da ação. Nada de diálogo genérico com dois
 * botões iguais.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  /** Itens afetados, mostrados como prévia (limitados a `maxPreview`). */
  items,
  maxPreview = 5,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  busy = false,
  /** Consequência em uma linha, destacada acima dos botões. */
  consequence,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  items?: string[];
  maxPreview?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: keyof typeof tones;
  busy?: boolean;
  consequence?: ReactNode;
}) {
  const toneStyle = tones[tone];
  const preview = items?.slice(0, maxPreview) ?? [];
  const hiddenCount = (items?.length ?? 0) - preview.length;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-3xl border border-border/60 bg-card p-0 shadow-2xl sm:max-w-[440px]">
        <div className="flex flex-col items-center px-6 pt-7 text-center">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              toneStyle.icon,
            )}
            style={
              tone === "accent"
                ? { backgroundColor: `${ACCENT}14`, color: ACCENT }
                : undefined
            }
          >
            <AlertTriangle size={22} />
          </span>

          <AlertDialogTitle className="mt-4 text-lg font-semibold tracking-tight">
            {title}
          </AlertDialogTitle>

          {description && (
            <AlertDialogDescription className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {description}
            </AlertDialogDescription>
          )}
        </div>

        {preview.length > 0 && (
          <div className="mx-6 mt-4 rounded-2xl border border-border/60 bg-background/60 px-3 py-2.5">
            <ul className="space-y-1">
              {preview.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span
                    className="h-1 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: toneStyle.accent }}
                  />
                  <span className="truncate" title={item}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>

            {hiddenCount > 0 && (
              <p className="mt-1.5 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
                e mais {hiddenCount}{" "}
                {hiddenCount === 1 ? "registro" : "registros"}
              </p>
            )}
          </div>
        )}

        {consequence && (
          <p
            className="mx-6 mt-4 rounded-2xl px-3 py-2 text-xs leading-relaxed"
            style={{
              backgroundColor: `${toneStyle.accent}0f`,
              color: toneStyle.accent,
            }}
          >
            {consequence}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border/60 bg-background/60 px-6 py-4 sm:flex-row">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center rounded-xl border border-border/60 px-4 text-sm text-muted-foreground transition hover:border-foreground/20 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
            style={{ backgroundColor: toneStyle.accent }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
