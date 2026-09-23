"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  BookUser,
  Building2,
  Bus,
  Check,
  Cpu,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import {
  CompanyPlan,
  companyPlanMeta,
  companyPlanOrder,
} from "@/lib/company-plans";
import api from "@/services/api";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PrimaryButton,
  StatusBadge,
} from "../components/page-kit";
import {
  FormField,
  fieldAccentStyle,
  fieldInputClass,
} from "../components/FormModal";
import {
  ACCENT,
  AnimatedNumber,
  Panel,
  SectionLabel,
  staggerParent,
} from "../components/primitives";

type PendingPlanChangeRequest = {
  currentPlan: CompanyPlan;
  requestedPlan: CompanyPlan;
  requestedAt: string;
  requestedByName: string | null;
  requestedByEmail: string | null;
};

type CompanyProfile = {
  id: string;
  name: string;
  cnpj: string;
  emailDomain: string;
  plan: CompanyPlan;
  contactName: string | null;
  contactPhone: string | null;
  smsVerifiedAt: string | null;
  createdAt: string;
  pendingPlanChangeRequest: PendingPlanChangeRequest | null;
  _count: {
    users: number;
    students: number;
    buses: number;
    devices: number;
  };
};

type FormErrors = Partial<
  Record<"name" | "cnpj" | "contactName" | "contactPhone", string>
>;

type PlanChangeResponse = {
  message: string;
  company: CompanyProfile;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === "string") return message;
  }

  return fallback;
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);

  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^55/, "").slice(0, 11);

  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CompanyPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN";

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPlanChange, setSavingPlanChange] = useState(false);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<CompanyPlan>("ESSENTIAL");
  const [errors, setErrors] = useState<FormErrors>({});
  const [form, setForm] = useState({
    name: "",
    cnpj: "",
    contactName: "",
    contactPhone: "",
  });

  const syncProfile = useCallback((nextProfile: CompanyProfile) => {
    setProfile(nextProfile);
    setForm({
      name: nextProfile.name,
      cnpj: formatCnpj(nextProfile.cnpj),
      contactName: nextProfile.contactName ?? "",
      contactPhone: formatPhone(nextProfile.contactPhone ?? ""),
    });
    setSelectedPlan(
      nextProfile.pendingPlanChangeRequest?.requestedPlan ?? nextProfile.plan,
    );
  }, []);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function fetchCompany() {
      try {
        const response = await api.get<CompanyProfile>("/companies/me", {
          signal: controller.signal,
        });

        syncProfile(response.data);
      } catch (error: unknown) {
        if (axios.isCancel(error)) return;

        toast.error(
          getErrorMessage(error, "Não foi possível carregar a empresa."),
        );
      } finally {
        setLoading(false);
      }
    }

    void Promise.resolve().then(fetchCompany);

    return () => controller.abort();
  }, [canManage, syncProfile]);

  function clearError(field: keyof FormErrors) {
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function validateForm() {
    const nextErrors: FormErrors = {};

    if (form.name.trim().length < 3) {
      nextErrors.name = "Informe o nome da empresa.";
    }

    if (form.cnpj.replace(/\D/g, "").length !== 14) {
      nextErrors.cnpj = "Digite um CNPJ válido com 14 números.";
    }

    if (form.contactName.trim() && form.contactName.trim().length < 3) {
      nextErrors.contactName = "Informe um nome válido para o responsável.";
    }

    if (
      form.contactPhone.trim() &&
      form.contactPhone.replace(/\D/g, "").length < 10
    ) {
      nextErrors.contactPhone = "Digite um telefone válido com DDD.";
    }

    setErrors(nextErrors);

    return Object.keys(nextErrors).length === 0;
  }

  async function handleProfileSubmit() {
    if (!validateForm()) {
      toast.error("Revise os campos antes de salvar.");
      return;
    }

    try {
      setSavingProfile(true);

      const response = await api.patch<CompanyProfile>("/companies/me", {
        name: form.name.trim(),
        cnpj: form.cnpj,
        contactName: form.contactName.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
      });

      syncProfile(response.data);
      toast.success("Dados da empresa atualizados com sucesso.");
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Não foi possível salvar as alterações."),
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePlanChangeRequest() {
    if (!profile) return;

    if (selectedPlan === profile.plan) {
      toast.error(
        "Selecione um plano diferente do atual para criar a pendência.",
      );
      return;
    }

    try {
      setSavingPlanChange(true);

      const response = await api.post<PlanChangeResponse>(
        "/companies/me/plan-change-request",
        { plan: selectedPlan },
      );

      syncProfile(response.data.company);
      toast.success(response.data.message);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          "Não foi possível registrar a solicitação de mudança de plano.",
        ),
      );
    } finally {
      setSavingPlanChange(false);
    }
  }

  if (!canManage) {
    return (
      <AccessDenied description="Somente o administrador da empresa pode editar os dados institucionais e solicitar mudanças de plano." />
    );
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-24 animate-pulse rounded-3xl bg-muted/70" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-3xl bg-muted/70"
            />
          ))}
        </div>
        <div className="h-[340px] animate-pulse rounded-3xl bg-muted/70" />
        <div className="h-[320px] animate-pulse rounded-3xl bg-muted/60" />
      </div>
    );
  }

  const pendingRequest = profile?.pendingPlanChangeRequest ?? null;
  const currentPlan = profile?.plan ?? "ESSENTIAL";
  const planButtonDisabled =
    !profile || selectedPlan === profile.plan || savingPlanChange;

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <PageHeader
        eyebrow="Administração"
        title={profile?.name ?? "Empresa"}
        description={`@${profile?.emailDomain ?? ""} · cliente desde ${formatDate(profile?.createdAt)}`}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="accent">
              Plano {companyPlanMeta[currentPlan].label}
            </StatusBadge>
            {profile?.smsVerifiedAt && (
              <StatusBadge tone="success" dot>
                Telefone verificado
              </StatusBadge>
            )}
          </div>
        }
      />

      {pendingRequest && (
        <Panel
          className="flex flex-wrap items-center gap-3 p-4"
          style={{ borderColor: `${ACCENT}44` }}
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
          >
            <ArrowRightLeft size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Pedido de troca em análise:{" "}
              {companyPlanMeta[pendingRequest.currentPlan].label} →{" "}
              {companyPlanMeta[pendingRequest.requestedPlan].label}
            </p>
            <p className="text-xs text-muted-foreground">
              Enviado em {formatDateTime(pendingRequest.requestedAt)}
              {pendingRequest.requestedByName
                ? ` por ${pendingRequest.requestedByName}`
                : ""}
              . O plano atual segue ativo até a plataforma concluir a mudança.
            </p>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Usuários"
          value={profile?._count.users ?? 0}
          icon={<Users size={15} />}
        />
        <MetricCard
          label="Alunos"
          value={profile?._count.students ?? 0}
          icon={<BookUser size={15} />}
        />
        <MetricCard
          label="Ônibus"
          value={profile?._count.buses ?? 0}
          icon={<Bus size={15} />}
        />
        <MetricCard
          label="UniHubs"
          value={profile?._count.devices ?? 0}
          icon={<Cpu size={15} />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="p-5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
            >
              <Building2 size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Dados institucionais
              </h2>
              <p className="text-xs text-muted-foreground">
                Usados no contato comercial e nos documentos da operação.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <FormField label="Nome da empresa" required error={errors.name}>
              <input
                value={form.name}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, name: event.target.value }));
                  clearError("name");
                }}
                placeholder="Tavares Transporte"
                className={fieldInputClass}
                style={fieldAccentStyle}
              />
            </FormField>

            <FormField label="CNPJ" required error={errors.cnpj}>
              <input
                value={form.cnpj}
                onChange={(event) => {
                  setForm((prev) => ({
                    ...prev,
                    cnpj: formatCnpj(event.target.value),
                  }));
                  clearError("cnpj");
                }}
                placeholder="00.000.000/0001-00"
                inputMode="numeric"
                className={`${fieldInputClass} tabular-nums`}
                style={fieldAccentStyle}
              />
            </FormField>

            <FormField label="Responsável" error={errors.contactName}>
              <input
                value={form.contactName}
                onChange={(event) => {
                  setForm((prev) => ({
                    ...prev,
                    contactName: event.target.value,
                  }));
                  clearError("contactName");
                }}
                placeholder="Nome do responsável"
                className={fieldInputClass}
                style={fieldAccentStyle}
              />
            </FormField>

            <FormField label="Telefone principal" error={errors.contactPhone}>
              <input
                value={form.contactPhone}
                onChange={(event) => {
                  setForm((prev) => ({
                    ...prev,
                    contactPhone: formatPhone(event.target.value),
                  }));
                  clearError("contactPhone");
                }}
                placeholder="(17) 98810-3154"
                inputMode="tel"
                className={`${fieldInputClass} tabular-nums`}
                style={fieldAccentStyle}
              />
            </FormField>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
            <p className="max-w-md text-xs text-muted-foreground">
              Ao salvar, os dados ficam disponíveis para sua equipe e apoiam o
              contato comercial em solicitações de plano.
            </p>

            <PrimaryButton
              onClick={() => void handleProfileSubmit()}
              disabled={savingProfile}
            >
              <Save size={14} />
              {savingProfile ? "Salvando..." : "Salvar alterações"}
            </PrimaryButton>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <SectionLabel>Identidade de acesso</SectionLabel>
            <p className="mt-2 text-sm">
              Todo login desta empresa usa o domínio
            </p>
            <p
              className="mt-1 break-all text-lg font-semibold"
              style={{ color: ACCENT }}
            >
              @{profile?.emailDomain}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              O domínio é fixo e único por empresa: é ele que garante que cada
              usuário e aluno pertença à operação certa.
            </p>
          </Panel>

          <Panel className="p-5">
            <SectionLabel>Verificação</SectionLabel>
            <div className="mt-3 flex items-center gap-2.5">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  profile?.smsVerifiedAt
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                )}
              >
                <ShieldCheck size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {profile?.smsVerifiedAt
                    ? "Telefone verificado"
                    : "Telefone não verificado"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.smsVerifiedAt
                    ? formatDateTime(profile.smsVerifiedAt)
                    : "A verificação acontece no cadastro da empresa."}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
            >
              <ArrowRightLeft size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Mudança de plano
              </h2>
              <p className="text-xs text-muted-foreground">
                A troca não é automática: vira uma pendência para o dono da
                plataforma.
              </p>
            </div>
          </div>

          <StatusBadge>
            Selecionado: {companyPlanMeta[selectedPlan].label}
          </StatusBadge>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-3">
          {companyPlanOrder.map((plan) => {
            const meta = companyPlanMeta[plan];
            const isCurrent = profile?.plan === plan;
            const isSelected = selectedPlan === plan;
            const isPending =
              profile?.pendingPlanChangeRequest?.requestedPlan === plan;

            return (
              <button
                key={plan}
                type="button"
                onClick={() => setSelectedPlan(plan)}
                aria-pressed={isSelected}
                className={cn(
                  "cursor-pointer rounded-2xl border p-4 text-left transition",
                  isSelected
                    ? "bg-accent/40"
                    : "border-border/60 hover:border-foreground/20 hover:bg-accent/20",
                )}
                style={
                  isSelected
                    ? {
                        borderColor: ACCENT,
                        boxShadow: `0 0 0 1px ${ACCENT}44`,
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <SectionLabel>{meta.eyebrow}</SectionLabel>
                    <p className="mt-0.5 text-base font-semibold tracking-tight">
                      {meta.label}
                    </p>
                  </div>

                  {isSelected && (
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: ACCENT }}
                    >
                      <Check size={12} />
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {meta.description}
                </p>

                <ul className="mt-3 space-y-1.5">
                  {meta.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex gap-1.5 text-xs text-muted-foreground"
                    >
                      <Check
                        size={12}
                        className="mt-0.5 shrink-0"
                        style={{ color: ACCENT }}
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {isCurrent && (
                    <StatusBadge tone="success" dot>
                      Plano atual
                    </StatusBadge>
                  )}
                  {isPending && !isCurrent && (
                    <StatusBadge tone="warning" dot>
                      Solicitado
                    </StatusBadge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
          <p className="max-w-lg text-xs text-muted-foreground">
            O plano atual ({companyPlanMeta[currentPlan].label}) continua ativo
            até o dono da plataforma concluir a mudança.
          </p>

          <PrimaryButton
            onClick={() => void handlePlanChangeRequest()}
            disabled={planButtonDisabled}
          >
            <Sparkles size={14} />
            {savingPlanChange
              ? "Enviando..."
              : pendingRequest
                ? "Atualizar solicitação"
                : "Solicitar mudança de plano"}
          </PrimaryButton>
        </div>
      </Panel>
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
        >
          {icon}
        </span>
      </div>
      <AnimatedNumber
        value={value}
        className="mt-3 block text-2xl font-semibold leading-none tracking-tight"
      />
    </Panel>
  );
}
