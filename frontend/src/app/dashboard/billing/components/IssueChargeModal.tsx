"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FilePlus2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import type { BillingGroup } from "@/app/dashboard/billing-groups/types/billing-group";
import {
  FormField,
  FormModal,
  FormSection,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "@/app/dashboard/components/FormModal";
import { useDebouncedValue } from "@/app/dashboard/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import api from "@/services/api";
import { getApiErrorMessage } from "../settings/hooks/useBillingGateway";
import {
  formatCalendarDate,
  formatCurrency,
  gatewayLabels,
  type ChargeActionResult,
  type ChargePreview,
} from "../types/charge";
import { ChargeDetails } from "./ChargeDetails";

type StudentOption = {
  id: string;
  name: string;
  registration: string;
  billingTemplateId?: string | null;
};

type Step = "form" | "review" | "result";

type IssueForm = {
  studentId: string;
  templateId: string;
  referenceMonth: string;
  amount: string;
  dueDate: string;
  description: string;
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Mesmo cálculo do backend: dia do grupo, limitado ao último dia do mês. */
function defaultDueDate(month: string, dueDay: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return "";
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function inputToCents(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
}

/**
 * Emissão de UM boleto em três passos: dados → revisão → resultado.
 * Nada é enviado ao gateway antes da revisão; a revisão mostra exatamente o
 * que impede a emissão (CPF faltando, cobrança já existente...).
 */
export function IssueChargeModal({
  open,
  onOpenChange,
  templates,
  onIssued,
  onOpenCharge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: BillingGroup[];
  onIssued: () => void;
  onOpenCharge: (chargeId: string) => void;
}) {
  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState<IssueForm>({
    studentId: "",
    templateId: "",
    referenceMonth: currentMonthKey(),
    amount: "",
    dueDate: "",
    description: "",
  });
  const [studentSearch, setStudentSearch] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [result, setResult] = useState<ChargeActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const debouncedSearch = useDebouncedValue(studentSearch, 350);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === form.templateId) ?? null,
    [form.templateId, templates],
  );

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setForm({
      studentId: "",
      templateId: "",
      referenceMonth: currentMonthKey(),
      amount: "",
      dueDate: "",
      description: "",
    });
    setStudentSearch("");
    setSelectedStudent(null);
    setPreview(null);
    setResult(null);
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open || selectedStudent) return;
    const controller = new AbortController();

    api
      .get<{ data: StudentOption[] }>("/students", {
        params: {
          page: 1,
          limit: 8,
          active: "true",
          ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
        },
        signal: controller.signal,
      })
      .then((response) => setStudentOptions(response.data.data))
      .catch(() => undefined);

    return () => controller.abort();
  }, [debouncedSearch, open, selectedStudent]);

  // Escolher grupo ou mês preenche valor e vencimento do grupo (editáveis).
  function applyTemplateDefaults(templateId: string, month: string) {
    const template = templates.find((item) => item.id === templateId);
    setForm((current) => ({
      ...current,
      templateId,
      referenceMonth: month,
      amount: template ? centsToInput(template.amountCents) : current.amount,
      dueDate: template ? defaultDueDate(month, template.dueDay) : current.dueDate,
    }));
  }

  function pickStudent(student: StudentOption) {
    setSelectedStudent(student);
    setForm((current) => ({ ...current, studentId: student.id }));
    if (student.billingTemplateId && templates.some((t) => t.id === student.billingTemplateId)) {
      applyTemplateDefaults(student.billingTemplateId, form.referenceMonth);
    }
  }

  function buildBody() {
    const amountCents = inputToCents(form.amount);
    return {
      studentId: form.studentId,
      templateId: form.templateId,
      referenceMonth: form.referenceMonth,
      ...(Number.isFinite(amountCents) && amountCents > 0 ? { amountCents } : {}),
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
  }

  async function goToReview() {
    if (!form.studentId) return setFormError("Escolha o aluno.");
    if (!form.templateId) return setFormError("Escolha o grupo de boletos.");
    if (!/^\d{4}-\d{2}$/.test(form.referenceMonth))
      return setFormError("Informe o mês de referência.");
    const cents = inputToCents(form.amount);
    if (!Number.isFinite(cents) || cents <= 0)
      return setFormError("Informe um valor maior que zero (ex.: 350,00).");

    setFormError(null);
    setBusy(true);
    try {
      const response = await api.post<ChargePreview>("/billing/charges/preview", buildBody());
      setPreview(response.data);
      setStep("review");
    } catch (error) {
      setFormError(getApiErrorMessage(error, "Não foi possível revisar a cobrança."));
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      const response = await api.post<ChargeActionResult>("/billing/charges", buildBody());
      setResult(response.data);
      setStep("result");
      onIssued();
      if (response.data.outcome === "ISSUED") toast.success("Boleto emitido.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível emitir o boleto."));
      // A situação pode ter mudado (outra emissão, CPF removido): revisa de novo.
      await goToReview();
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!result) return;
    setBusy(true);
    try {
      const response = await api.post<ChargeActionResult>(
        `/billing/charges/${result.charge.id}/retry`,
      );
      setResult(response.data);
      onIssued();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível reenviar ao Asaas."));
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === "form" ? (
      <>
        <ModalCancelButton onClick={() => onOpenChange(false)}>Cancelar</ModalCancelButton>
        <ModalSubmitButton onClick={() => void goToReview()} busy={busy}>
          Revisar
        </ModalSubmitButton>
      </>
    ) : step === "review" ? (
      <>
        <ModalCancelButton onClick={() => setStep("form")} disabled={busy}>
          Voltar e corrigir
        </ModalCancelButton>
        <ModalSubmitButton
          onClick={() => void issue()}
          busy={busy}
          disabled={!preview?.canIssue}
        >
          Emitir boleto
        </ModalSubmitButton>
      </>
    ) : (
      <>
        <ModalCancelButton onClick={() => onOpenChange(false)}>Fechar</ModalCancelButton>
        {result?.outcome === "FAILED" ? (
          <ModalSubmitButton onClick={() => void retry()} busy={busy}>
            <RotateCcw size={14} />
            Tentar de novo
          </ModalSubmitButton>
        ) : (
          <ModalSubmitButton
            onClick={() => {
              setStep("form");
              setSelectedStudent(null);
              setForm((current) => ({ ...current, studentId: "", description: "" }));
              setResult(null);
            }}
          >
            Emitir outro
          </ModalSubmitButton>
        )}
      </>
    );

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        step === "form" ? "Emitir boleto" : step === "review" ? "Revise antes de emitir" : "Resultado"
      }
      description={
        step === "form"
          ? "Valor e vencimento vêm do grupo de boletos e podem ser ajustados."
          : undefined
      }
      icon={<FilePlus2 size={18} />}
      size="md"
      footer={footer}
    >
      {step === "form" && (
        <div className="space-y-5">
          <FormSection title="Aluno">
            {selectedStudent ? (
              <div className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{selectedStudent.name}</span>
                  <span className="text-muted-foreground"> · {selectedStudent.registration}</span>
                </span>
                <button
                  type="button"
                  className="text-xs underline-offset-2 hover:underline"
                  onClick={() => {
                    setSelectedStudent(null);
                    setForm((current) => ({ ...current, studentId: "" }));
                  }}
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Buscar por nome ou matrícula"
                    className={cn(fieldInputClass, "pl-8")}
                    style={fieldAccentStyle}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-border/60">
                  {studentOptions.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      Nenhum aluno ativo encontrado.
                    </p>
                  ) : (
                    studentOptions.map((student) => (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => pickStudent(student)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span>{student.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {student.registration}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </FormSection>

          <FormSection title="Cobrança">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Grupo de boletos" required>
                <select
                  value={form.templateId}
                  onChange={(event) =>
                    applyTemplateDefaults(event.target.value, form.referenceMonth)
                  }
                  className={fieldInputClass}
                  style={fieldAccentStyle}
                >
                  <option value="">Escolha um grupo</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Mês de referência" required>
                <input
                  type="month"
                  value={form.referenceMonth}
                  onChange={(event) =>
                    applyTemplateDefaults(form.templateId, event.target.value)
                  }
                  className={fieldInputClass}
                  style={fieldAccentStyle}
                />
              </FormField>
              <FormField
                label="Valor (R$)"
                required
                hint={
                  selectedTemplate
                    ? `Do grupo: ${formatCurrency(selectedTemplate.amountCents)}`
                    : undefined
                }
              >
                <input
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, amount: event.target.value }))
                  }
                  placeholder="350,00"
                  className={fieldInputClass}
                  style={fieldAccentStyle}
                />
              </FormField>
              <FormField
                label="Vencimento"
                required
                hint={selectedTemplate ? `Dia ${selectedTemplate.dueDay} do grupo` : undefined}
              >
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                  className={fieldInputClass}
                  style={fieldAccentStyle}
                />
              </FormField>
            </div>
            <FormField label="Descrição" hint="Em branco: nome do grupo + mês.">
              <input
                value={form.description}
                maxLength={500}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                className={fieldInputClass}
                style={fieldAccentStyle}
              />
            </FormField>
          </FormSection>

          {formError && <p className="text-sm text-red-500">{formError}</p>}
        </div>
      )}

      {step === "review" && preview && (
        <div className="space-y-4">
          {preview.problems.length > 0 && (
            <div className="space-y-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle size={15} className="text-red-500" />
                Corrija antes de emitir:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {preview.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              {preview.existingCharge && (
                <button
                  type="button"
                  className="text-xs font-medium underline-offset-2 hover:underline"
                  onClick={() => onOpenCharge(preview.existingCharge!.id)}
                >
                  Ver a cobrança existente ({formatCurrency(preview.existingCharge.amountCents)},
                  vence {formatCalendarDate(preview.existingCharge.dueDate)})
                </button>
              )}
            </div>
          )}

          <ReviewSection title="Cliente">
            <ReviewRow label="Aluno">
              {preview.student.name} · {preview.student.registration}
            </ReviewRow>
            <ReviewRow label="Nome">{preview.payer?.name ?? "Sem pagador (o aluno)"}</ReviewRow>
            <ReviewRow label="CPF/CNPJ">
              <span className="font-mono">
                {preview.payer?.document ?? "Não cadastrado"}
              </span>
            </ReviewRow>
          </ReviewSection>

          <ReviewSection title="Cobrança">
            <ReviewRow label="Valor">
              <span className="font-semibold">{formatCurrency(preview.amountCents)}</span>
            </ReviewRow>
            <ReviewRow label="Vencimento">{formatCalendarDate(preview.dueDate)}</ReviewRow>
            <ReviewRow label="Descrição">{preview.description}</ReviewRow>
            <ReviewRow label="Grupo">{preview.template.name}</ReviewRow>
          </ReviewSection>

          <ReviewSection title="Gateway">
            <ReviewRow label="Emissão por">{gatewayLabels[preview.gateway]}</ReviewRow>
            <p className="text-xs text-muted-foreground">
              {preview.gateway === "ASAAS"
                ? "A cobrança será criada na conta Asaas da empresa, com boleto e (se disponível) Pix."
                : "A cobrança fica registrada no UniPass; o boleto segue pelo processo próprio da empresa."}
            </p>
          </ReviewSection>
        </div>
      )}

      {step === "result" && result && (
        <div className="space-y-4">
          {result.outcome === "ISSUED" ? (
            <p className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              <CheckCircle2 size={16} className="text-emerald-500" />
              {result.charge.gateway === "ASAAS"
                ? "Boleto emitido no Asaas."
                : "Cobrança registrada no UniPass."}
            </p>
          ) : null}
          <ChargeDetails charge={result.charge} />
        </div>
      )}
    </FormModal>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-border/60 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm sm:text-right">{children}</span>
    </div>
  );
}
