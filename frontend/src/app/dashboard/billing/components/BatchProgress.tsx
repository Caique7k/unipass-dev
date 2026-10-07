"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { GhostButton, StatusBadge } from "@/app/dashboard/components/page-kit";
import { Panel } from "@/app/dashboard/components/primitives";
import api from "@/services/api";
import { getApiErrorMessage } from "../settings/hooks/useBillingGateway";
import { batchStatusMeta, type BatchDetail } from "../types/batch";
import {
  chargeStatusLabels,
  formatCurrency,
  gatewayLabels,
} from "../types/charge";

const POLL_MS = 2000;

/**
 * Andamento de um lote. Enquanto estiver processando, consulta a API a cada
 * 2 s; o processamento acontece no worker, então sair da tela não para nada.
 */
export function BatchProgress({
  batchId,
  onBack,
  onFinished,
  onOpenCharge,
}: {
  batchId: string;
  onBack: () => void;
  onFinished: () => void;
  onOpenCharge: (chargeId: string) => void;
}) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    finishedRef.current = false;

    const load = async () => {
      try {
        const response = await api.get<BatchDetail>(`/billing/batches/${batchId}`);
        if (cancelled) return;
        setBatch(response.data);
        setError(null);

        if (response.data.status === "PROCESSING") {
          timer = setTimeout(() => void load(), POLL_MS);
        } else if (!finishedRef.current) {
          finishedRef.current = true;
          onFinished();
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(getApiErrorMessage(loadError, "Não foi possível acompanhar o lote."));
        timer = setTimeout(() => void load(), POLL_MS * 2);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onFinished muda a cada render da página; o lote é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  if (!batch) {
    return (
      <Panel className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
        {error ?? (
          <>
            <Loader2 size={14} className="animate-spin" /> Carregando o lote…
          </>
        )}
      </Panel>
    );
  }

  const done = batch.succeeded + batch.failed;
  const percent = batch.total > 0 ? Math.round((done / batch.total) * 100) : 100;
  const status = batchStatusMeta[batch.status];
  const failures = batch.items.filter((item) => item.status === "FAILED");
  const waiting = batch.items.filter((item) => item.status === "DRAFT" && item.error);

  return (
    <Panel className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">
              Lote {batch.template?.name ?? "de todos os grupos"} ·{" "}
              {batch.referenceMonth.split("-").reverse().join("/")}
            </h3>
            <StatusBadge tone={status.tone} dot>
              {status.label}
            </StatusBadge>
            <StatusBadge tone={batch.gateway === "ASAAS" ? "info" : "neutral"}>
              Gateway: {gatewayLabels[batch.gateway]}
            </StatusBadge>
          </div>
          {batch.status === "PROCESSING" && (
            <p className="text-xs text-muted-foreground">
              Emitindo boletos… Pode sair desta tela: o lote continua sendo
              processado.
            </p>
          )}
        </div>
        <GhostButton onClick={onBack}>
          <ArrowLeft size={13} />
          Voltar
        </GhostButton>
      </div>

      <div className="space-y-2">
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#ff5c00] transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span className="font-medium">
            {done} / {batch.total} · {percent}%
          </span>
          <span className="text-muted-foreground">
            Sucesso: <b className="text-emerald-600 dark:text-emerald-400">{batch.succeeded}</b>
            {" · "}Erros: <b className="text-red-600 dark:text-red-400">{batch.failed}</b>
            {batch.pending > 0 && <> · Pendentes: {batch.pending}</>}
            {batch.skipped > 0 && <> · Fora do lote: {batch.skipped}</>}
          </span>
        </div>
      </div>

      {failures.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle size={15} className="text-red-500" />
            {failures.length} cobrança(s) não foram emitidas
          </p>
          <ul className="space-y-1.5 text-sm">
            {failures.map((item) => (
              <li key={item.chargeId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <b>{item.student?.name ?? "Aluno"}</b>: {item.error ?? "Erro sem detalhe."}
                </span>
                <button
                  type="button"
                  className="text-xs underline-offset-2 hover:underline"
                  onClick={() => onOpenCharge(item.chargeId)}
                >
                  Abrir e tentar de novo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {waiting.length} cobrança(s) aguardando nova tentativa automática
          (o Asaas respondeu com falha temporária).
        </p>
      )}

      {batch.skippedDetails.length > 0 && (
        <details className="rounded-2xl border border-border/60 p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            {batch.skippedDetails.length} aluno(s) ficaram fora do lote
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {batch.skippedDetails.map((item, index) => (
              <li key={`${item.studentId ?? "x"}-${index}`}>
                {item.studentName ?? "Aluno não encontrado"}: {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {batch.items.length > 0 && (
        <details className="rounded-2xl border border-border/60 p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Ver as {batch.items.length} cobrança(s) do lote
          </summary>
          <ul className="mt-2 divide-y divide-border/60">
            {batch.items.map((item) => (
              <li key={item.chargeId} className="flex items-center justify-between gap-2 py-1.5">
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline"
                  onClick={() => onOpenCharge(item.chargeId)}
                >
                  {item.student?.name ?? "Aluno"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(item.amountCents)} · {chargeStatusLabels[item.status]}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
