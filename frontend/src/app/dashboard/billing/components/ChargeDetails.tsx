"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/app/dashboard/components/page-kit";
import {
  chargeStatusLabels,
  formatCalendarDate,
  formatCurrency,
  gatewayLabels,
  type BillingCharge,
} from "../types/charge";

function statusTone(charge: BillingCharge) {
  if (charge.status === "PAID") return "success" as const;
  if (charge.status === "FAILED" || charge.isOverdue) return "danger" as const;
  if (charge.status === "CANCELLED" || charge.status === "REFUNDED")
    return "neutral" as const;
  return "warning" as const;
}

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error("Não foi possível copiar. Selecione e copie manualmente.");
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{children}</span>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copiar ${label}`}
          onClick={() => void copy(value, label)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 hover:bg-accent"
        >
          <Copy size={13} />
        </button>
      </div>
    </div>
  );
}

/** Tudo que o UniPass sabe de uma cobrança, para conferir e repassar. */
export function ChargeDetails({ charge }: { charge: BillingCharge }) {
  const isAsaas = charge.gateway === "ASAAS";
  const boletoUrl = charge.bankSlipUrl ?? charge.gatewayInvoiceUrl;
  const awaitingLine =
    isAsaas && charge.status !== "FAILED" && !charge.identificationField;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={statusTone(charge)} dot>
          {charge.isOverdue && charge.status !== "OVERDUE"
            ? "Em atraso"
            : chargeStatusLabels[charge.status]}
        </StatusBadge>
        <StatusBadge tone={isAsaas ? "info" : "neutral"}>
          Gateway: {gatewayLabels[charge.gateway]}
        </StatusBadge>
      </div>

      {charge.status === "FAILED" && charge.gatewayError && (
        <div className="flex gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="font-medium">A cobrança não foi criada no Asaas.</p>
            <p className="mt-1">{charge.gatewayError}</p>
          </div>
        </div>
      )}

      <section className="space-y-2 rounded-2xl border border-border/60 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Cliente
        </p>
        <Row label="Aluno">{charge.student?.name ?? "--"}</Row>
        <Row label="Pagador">{charge.customer?.name ?? charge.recipientName}</Row>
        <Row label="CPF/CNPJ">
          <span className="font-mono">
            {charge.customer?.document ?? charge.recipientDocument ?? "Não informado"}
          </span>
        </Row>
      </section>

      <section className="space-y-2 rounded-2xl border border-border/60 p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Cobrança
        </p>
        <Row label="Valor">
          <span className="font-semibold">{formatCurrency(charge.amountCents)}</span>
        </Row>
        <Row label="Vencimento">{formatCalendarDate(charge.dueDate)}</Row>
        <Row label="Emissão">{formatCalendarDate(charge.issueDate)}</Row>
        <Row label="Descrição">{charge.description}</Row>
        {charge.template && <Row label="Grupo">{charge.template.name}</Row>}
        {charge.paidAt && <Row label="Pago em">{formatCalendarDate(charge.paidAt)}</Row>}
        {charge.gatewayChargeId && (
          <Row label="Id no Asaas">
            <span className="font-mono text-xs">{charge.gatewayChargeId}</span>
          </Row>
        )}
      </section>

      {(boletoUrl || charge.identificationField || charge.pixPayload) && (
        <section className="space-y-3 rounded-2xl border border-border/60 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Pagamento
          </p>
          {charge.identificationField && (
            <CopyField label="Linha digitável" value={charge.identificationField} />
          )}
          {charge.barCode && <CopyField label="Código de barras" value={charge.barCode} />}
          {charge.pixPayload ? (
            <CopyField label="Pix copia e cola" value={charge.pixPayload} />
          ) : (
            isAsaas &&
            charge.status !== "FAILED" && (
              <p className="text-xs text-muted-foreground">
                Pix indisponível para esta cobrança. Para oferecer Pix junto do
                boleto, cadastre uma chave Pix na conta Asaas da empresa.
              </p>
            )
          )}
          {awaitingLine && boletoUrl && (
            <p className="text-xs text-muted-foreground">
              A linha digitável não está gravada (ou mudou no Asaas). Use o
              link do boleto, que o Asaas mantém atualizado.
            </p>
          )}
          {boletoUrl && (
            <a
              href={boletoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium hover:bg-muted"
            >
              Abrir boleto
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </section>
      )}
    </div>
  );
}
