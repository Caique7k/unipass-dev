"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { BillingGroup } from "@/app/dashboard/billing-groups/types/billing-group";
import {
  ConfirmDialog,
  FilterChips,
  GhostButton,
  PrimaryButton,
  StatusBadge,
} from "@/app/dashboard/components/page-kit";
import { Panel, PanelHeader } from "@/app/dashboard/components/primitives";
import {
  FormField,
  fieldAccentStyle,
  fieldInputClass,
} from "@/app/dashboard/components/FormModal";
import { cn } from "@/lib/utils";
import api from "@/services/api";
import { getApiErrorMessage } from "../settings/hooks/useBillingGateway";
import type { BillingGatewayMode } from "../settings/types/billing-gateway";
import {
  batchStateLabels,
  batchStatusMeta,
  type BatchCandidateState,
  type BatchDetail,
  type BatchPreview,
  type BatchSummary,
} from "../types/batch";
import { formatCalendarDate, formatCurrency, gatewayLabels } from "../types/charge";
import { BatchProgress } from "./BatchProgress";

type Filter = "ALL" | "READY" | "MISSING_DOCUMENT" | "ALREADY_CHARGED" | "OTHER";

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function matches(filter: Filter, state: BatchCandidateState) {
  if (filter === "ALL") return true;
  if (filter === "OTHER") return state === "DUE_BEFORE_ISSUE";
  return state === filter;
}

/**
 * Emissão em massa: grupo e mês → prévia (cada aluno com a situação dele)
 * → marcar quem entra → confirmar → acompanhar o lote. Gateway próprio
 * termina na hora; Asaas segue pela fila do worker.
 */
export function BulkIssuePanel({
  gateway,
  templates,
  onChanged,
  onOpenCharge,
}: {
  gateway: BillingGatewayMode;
  templates: BillingGroup[];
  onChanged: () => void;
  onOpenCharge: (chargeId: string) => void;
}) {
  const [templateId, setTemplateId] = useState("all");
  const [referenceMonth, setReferenceMonth] = useState(todayKey().slice(0, 7));
  const [issueDate, setIssueDate] = useState(todayKey());
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [recent, setRecent] = useState<BatchSummary[]>([]);
  const isAsaas = gateway === "ASAAS";

  const loadRecent = useCallback(async () => {
    try {
      const response = await api.get<{ data: BatchSummary[] }>("/billing/batches", {
        params: { page: 1, limit: 5 },
      });
      setRecent(response.data.data);
    } catch {
      // A lista de lotes é um complemento; a emissão funciona sem ela.
    }
  }, []);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  async function loadPreview() {
    setLoadingPreview(true);
    try {
      const response = await api.post<BatchPreview>("/billing/batches/preview", {
        referenceMonth,
        ...(templateId !== "all" ? { templateId } : {}),
        ...(!isAsaas ? { issueDate } : {}),
      });
      setPreview(response.data);
      setSelected(
        new Set(
          response.data.items
            .filter((item) => item.state === "READY")
            .map((item) => item.studentId),
        ),
      );
      setFilter("ALL");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível montar a prévia."));
    } finally {
      setLoadingPreview(false);
    }
  }

  async function createBatch() {
    if (!preview) return;
    setCreating(true);
    try {
      const response = await api.post<BatchDetail>("/billing/batches", {
        referenceMonth,
        ...(templateId !== "all" ? { templateId } : {}),
        ...(!isAsaas ? { issueDate } : {}),
        studentIds: [...selected],
      });
      setConfirming(false);
      setPreview(null);
      setActiveBatchId(response.data.id);
      onChanged();
      void loadRecent();
      toast.success(
        response.data.status === "PROCESSING"
          ? "Lote criado. Os boletos estão sendo emitidos no Asaas."
          : "Lote emitido.",
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível criar o lote."));
    } finally {
      setCreating(false);
    }
  }

  const visibleItems = useMemo(
    () => preview?.items.filter((item) => matches(filter, item.state)) ?? [],
    [filter, preview],
  );
  const readyIds = useMemo(
    () => preview?.items.filter((item) => item.state === "READY").map((item) => item.studentId) ?? [],
    [preview],
  );
  const selectedAmount = useMemo(
    () =>
      preview?.items
        .filter((item) => selected.has(item.studentId))
        .reduce((sum, item) => sum + item.amountCents, 0) ?? 0,
    [preview, selected],
  );
  const dueDates = useMemo(() => {
    const dates = new Set(
      preview?.items.filter((item) => selected.has(item.studentId)).map((item) => item.dueDate) ?? [],
    );
    return [...dates].sort();
  }, [preview, selected]);
  const incomplete = preview
    ? preview.counts.MISSING_DOCUMENT + preview.counts.DUE_BEFORE_ISSUE
    : 0;

  if (activeBatchId) {
    return (
      <BatchProgress
        batchId={activeBatchId}
        onBack={() => {
          setActiveBatchId(null);
          void loadRecent();
        }}
        onFinished={() => {
          onChanged();
          void loadRecent();
        }}
        onOpenCharge={onOpenCharge}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Emissão em massa"
          hint={
            isAsaas
              ? "As cobranças são criadas no Asaas pela fila, uma a uma. A emissão é feita hoje."
              : "As cobranças são registradas no UniPass. Data de emissão futura deixa a cobrança agendada."
          }
          action={
            <StatusBadge tone={isAsaas ? "info" : "neutral"}>
              Gateway: {gatewayLabels[gateway]}
            </StatusBadge>
          }
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Grupo de boletos">
            <select
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setPreview(null);
              }}
              className={fieldInputClass}
              style={fieldAccentStyle}
            >
              <option value="all">Todos os grupos ativos</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template._count.students} aluno(s))
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Mês de referência">
            <input
              type="month"
              value={referenceMonth}
              onChange={(event) => {
                setReferenceMonth(event.target.value);
                setPreview(null);
              }}
              className={fieldInputClass}
              style={fieldAccentStyle}
            />
          </FormField>
          {!isAsaas && (
            <FormField label="Data de emissão">
              <input
                type="date"
                value={issueDate}
                onChange={(event) => {
                  setIssueDate(event.target.value);
                  setPreview(null);
                }}
                className={fieldInputClass}
                style={fieldAccentStyle}
              />
            </FormField>
          )}
          <div className="flex items-end">
            <PrimaryButton
              onClick={() => void loadPreview()}
              disabled={loadingPreview || !referenceMonth}
            >
              {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
              Ver prévia
            </PrimaryButton>
          </div>
        </div>
      </Panel>

      {preview && (
        <Panel className="space-y-4 p-5">
          {isAsaas && !preview.readyToIssue && (
            <div className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
              A integração com o Asaas não está pronta: {preview.pendingSteps.join(" ")}
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
            <p className="text-base font-semibold">
              {selected.size} cobrança(s) serão emitidas
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Valor total: <b className="text-foreground">{formatCurrency(selectedAmount)}</b>
              {" · "}Vencimento:{" "}
              {dueDates.length === 0
                ? "--"
                : dueDates.length === 1
                  ? formatCalendarDate(`${dueDates[0]}T12:00:00Z`)
                  : `${dueDates.length} datas (${formatCalendarDate(`${dueDates[0]}T12:00:00Z`)} a ${formatCalendarDate(`${dueDates[dueDates.length - 1]}T12:00:00Z`)})`}
              {" · "}Gateway: {gatewayLabels[preview.gateway]}
            </p>
          </div>

          {incomplete > 0 && (
            <button
              type="button"
              onClick={() => setFilter(preview.counts.MISSING_DOCUMENT > 0 ? "MISSING_DOCUMENT" : "OTHER")}
              className="flex w-full items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm"
            >
              <AlertTriangle size={15} className="shrink-0 text-amber-500" />
              {incomplete} aluno(s) possuem dados incompletos e não serão cobrados. Ver quais →
            </button>
          )}

          <FilterChips<Filter>
            layoutId="bulk-issue-filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ALL", label: "Todos", count: preview.counts.total },
              { value: "READY", label: "Prontos", count: preview.counts.READY },
              { value: "MISSING_DOCUMENT", label: "Sem CPF/CNPJ", count: preview.counts.MISSING_DOCUMENT },
              { value: "ALREADY_CHARGED", label: "Já cobrados", count: preview.counts.ALREADY_CHARGED },
              { value: "OTHER", label: "Outros problemas", count: preview.counts.DUE_BEFORE_ISSUE },
            ]}
          />

          <div className="overflow-hidden rounded-2xl border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Marcar todos os prontos"
                      checked={readyIds.length > 0 && readyIds.every((id) => selected.has(id))}
                      onChange={(event) =>
                        setSelected(event.target.checked ? new Set(readyIds) : new Set())
                      }
                    />
                  </th>
                  <th className="px-3 py-2">Aluno</th>
                  <th className="hidden px-3 py-2 md:table-cell">Pagador</th>
                  <th className="px-3 py-2">Valor</th>
                  <th className="hidden px-3 py-2 sm:table-cell">Vencimento</th>
                  <th className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      {preview.counts.total === 0
                        ? "Nenhum aluno ativo com grupo de boletos ativo encontrado."
                        : "Nenhum aluno nesta situação."}
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((item) => {
                    const ready = item.state === "READY";
                    return (
                      <tr key={item.studentId} className={cn(!ready && "text-muted-foreground")}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Incluir ${item.studentName}`}
                            disabled={!ready}
                            checked={selected.has(item.studentId)}
                            onChange={(event) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(item.studentId);
                                else next.delete(item.studentId);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium text-foreground">{item.studentName}</p>
                          <p className="text-xs">{item.templateName}</p>
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          <p>{item.payerName}</p>
                          <p className="font-mono text-xs">{item.payerDocument ?? "sem CPF/CNPJ"}</p>
                        </td>
                        <td className="px-3 py-2">{formatCurrency(item.amountCents)}</td>
                        <td className="hidden px-3 py-2 sm:table-cell">
                          {formatCalendarDate(`${item.dueDate}T12:00:00Z`)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={ready ? "success" : item.state === "ALREADY_CHARGED" ? "neutral" : "warning"}>
                            {batchStateLabels[item.state]}
                          </StatusBadge>
                          {item.reason && <p className="mt-1 text-xs">{item.reason}</p>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <GhostButton onClick={() => setPreview(null)}>Cancelar</GhostButton>
            <PrimaryButton
              onClick={() => setConfirming(true)}
              disabled={selected.size === 0 || (isAsaas && !preview.readyToIssue)}
            >
              Emitir {selected.size} cobrança(s)
            </PrimaryButton>
          </div>
        </Panel>
      )}

      {recent.length > 0 && (
        <Panel>
          <PanelHeader title="Lotes recentes" />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {recent.map((batch) => {
              const meta = batchStatusMeta[batch.status];
              return (
                <li key={batch.id}>
                  <button
                    type="button"
                    onClick={() => setActiveBatchId(batch.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-sm hover:opacity-80"
                  >
                    <span>
                      <span className="font-medium">
                        {batch.template?.name ?? "Todos os grupos"} ·{" "}
                        {batch.referenceMonth.split("-").reverse().join("/")}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}· {batch.succeeded}/{batch.total} emitidas
                        {batch.failed > 0 && ` · ${batch.failed} erro(s)`} ·{" "}
                        {gatewayLabels[batch.gateway]}
                      </span>
                    </span>
                    <StatusBadge tone={meta.tone} dot>
                      {meta.label}
                    </StatusBadge>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void createBatch()}
        tone="accent"
        title={`Emitir ${selected.size} cobrança(s)?`}
        description={`Valor total ${formatCurrency(selectedAmount)} · Gateway ${preview ? gatewayLabels[preview.gateway] : ""}.`}
        items={
          preview?.items
            .filter((item) => selected.has(item.studentId))
            .map((item) => `${item.studentName} — ${formatCurrency(item.amountCents)}`) ?? []
        }
        consequence={
          isAsaas
            ? "As cobranças serão criadas no Asaas e chegam aos pagadores. Você pode acompanhar e sair da tela."
            : "As cobranças ficam registradas no UniPass."
        }
        confirmLabel="Emitir"
        busy={creating}
      />
    </div>
  );
}
