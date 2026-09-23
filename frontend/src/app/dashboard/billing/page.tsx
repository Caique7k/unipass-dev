"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  Search,
  SendHorizontal,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { PageTableSkeleton } from "@/app/dashboard/components/DashboardSkeletons";
import type {
  BillingGroup,
  BillingTemplateRecurrence,
} from "@/app/dashboard/billing-groups/types/billing-group";
import { billingRecurrenceLabels } from "@/app/dashboard/billing-groups/types/billing-group";
import { AccessDenied } from "@/components/AccessDenied";
import {
  GhostButton,
  PageHeader,
} from "@/app/dashboard/components/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { roleLabels, type UserRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import api from "@/services/api";

type AccessScope = "company" | "self";
type BillingTab = "company" | "issue" | "charges";
type BillingChargeStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ISSUED"
  | "SENT"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "FAILED";
type BillingChargeStatusFilter =
  | "ALL"
  | "OPEN"
  | "PAID"
  | "OVERDUE"
  | "SCHEDULED"
  | "ISSUED"
  | "SENT"
  | "DRAFT"
  | "CANCELLED"
  | "FAILED";
type BillingGatewayMode = "EXTERNAL" | "PLATFORM_GATEWAY";
type BillingOnboardingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "UNDER_REVIEW"
  | "ACTIVE"
  | "REJECTED"
  | "SUSPENDED";

type BillingOverviewResponse = {
  accessScope: AccessScope;
  permissions: {
    canManageGateway: boolean;
    canViewCompanyOverview: boolean;
    canViewOwnCharges: boolean;
  };
  settings: {
    usePlatformGateway: boolean;
    gatewayMode: BillingGatewayMode;
    onboardingStatus: BillingOnboardingStatus;
    gatewayContactName: string | null;
    gatewayContactEmail: string | null;
    gatewayContactPhone: string | null;
    legalEntityName: string | null;
    legalDocument: string | null;
    bankInfoSummary: string | null;
    defaultAmountCents: number | null;
    defaultDueDay: number | null;
    lgpdAcceptedAt: string | null;
    platformTermsAcceptedAt: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
    asaasAccountId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  tutorial: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  onboardingChecklist: Array<{
    id: string;
    label: string;
    done: boolean;
  }>;
  summaryCards: Array<{
    id: string;
    label: string;
    value: number;
    helper: string;
  }>;
  charges: BillingCharge[];
};

type BillingCharge = {
  id: string;
  description: string;
  amountCents: number;
  issueDate: string;
  dueDate: string;
  status: BillingChargeStatus;
  gatewayStatus: string | null;
  paidAt: string | null;
  bankSlipUrl: string | null;
  gatewayInvoiceUrl: string | null;
  externalReference: string | null;
  recipientName: string;
  recipientEmail: string | null;
  isOverdue: boolean;
  student: {
    id: string;
    name: string;
    registration: string;
  } | null;
  customer: {
    id: string;
    name: string;
    email: string | null;
    document: string | null;
    asaasCustomerId: string | null;
  } | null;
  template: {
    id: string;
    name: string;
    recurrence: BillingTemplateRecurrence;
  } | null;
  ownerUser: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  } | null;
};

type BillingChargesResponse = {
  data: BillingCharge[];
  total: number;
  page: number;
  lastPage: number;
};

type BillingGroupsResponse = {
  data: BillingGroup[];
  lastPage: number;
};

type BillingIssueResponse = {
  createdCount: number;
  skippedCount: number;
};

type BillingSettingsForm = {
  usePlatformGateway: boolean;
  gatewayContactName: string;
  gatewayContactEmail: string;
  gatewayContactPhone: string;
  legalEntityName: string;
  legalDocument: string;
  bankInfoSummary: string;
  lgpdAccepted: boolean;
  platformTermsAccepted: boolean;
};

type ChargeFilters = {
  search: string;
  month: string;
  status: BillingChargeStatusFilter;
  templateId: string;
  page: number;
};

type BillingIssueForm = {
  templateId: string;
  referenceMonth: string;
  issueDate: string;
};

const chargeStatusFilterOptions: Array<{
  value: BillingChargeStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "Todos" },
  { value: "OPEN", label: "Em aberto" },
  { value: "ISSUED", label: "Emitidos" },
  { value: "PAID", label: "Pagos" },
  { value: "OVERDUE", label: "Em atraso" },
  { value: "SCHEDULED", label: "Agendados" },
  { value: "SENT", label: "Enviados" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "CANCELLED", label: "Cancelados" },
  { value: "FAILED", label: "Falharam" },
];

const primaryChargeStatusTabs: BillingChargeStatusFilter[] = [
  "ALL",
  "OPEN",
  "ISSUED",
  "PAID",
  "OVERDUE",
  "SCHEDULED",
];

function getErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (Array.isArray(message)) {
      return message[0] ?? fallback;
    }

    if (typeof message === "string") {
      return message;
    }
  }

  return fallback;
}

function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
}

function formatDate(value?: string | null) {
  if (!value) return "--";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMonthLabel(value?: string | null) {
  if (!value) return "--";

  const match = /^(\d{4})-(\d{2})/.exec(value);

  if (!match) {
    return value;
  }

  return `${match[2]}/${match[1]}`;
}

function formatStatus(status: BillingChargeStatus | BillingOnboardingStatus) {
  const labels: Record<string, string> = {
    DRAFT: "Rascunho",
    SCHEDULED: "Agendado",
    ISSUED: "Emitido",
    SENT: "Enviado",
    PAID: "Pago",
    OVERDUE: "Em atraso",
    CANCELLED: "Cancelado",
    FAILED: "Falhou",
    NOT_STARTED: "Nao iniciado",
    IN_PROGRESS: "Em configuracao",
    UNDER_REVIEW: "Em analise",
    ACTIVE: "Ativo",
    REJECTED: "Rejeitado",
    SUSPENDED: "Suspenso",
  };

  return labels[status] ?? status;
}

function getChargeStatusFilterLabel(status: BillingChargeStatusFilter) {
  return (
    chargeStatusFilterOptions.find((option) => option.value === status)?.label ??
    status
  );
}

function getDateKey(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getCurrentMonthKey() {
  return getDateKey().slice(0, 7);
}

function buildInitialForm(): BillingSettingsForm {
  return {
    usePlatformGateway: false,
    gatewayContactName: "",
    gatewayContactEmail: "",
    gatewayContactPhone: "",
    legalEntityName: "",
    legalDocument: "",
    bankInfoSummary: "",
    lgpdAccepted: false,
    platformTermsAccepted: false,
  };
}

function buildDefaultChargeFilters(): ChargeFilters {
  return {
    search: "",
    month: getCurrentMonthKey(),
    status: "ALL",
    templateId: "all",
    page: 1,
  };
}

function buildDefaultIssueForm(): BillingIssueForm {
  return {
    templateId: "all",
    referenceMonth: getCurrentMonthKey(),
    issueDate: getDateKey(),
  };
}

function hasBillingConfiguration(settings: BillingOverviewResponse["settings"]) {
  return (
    settings.createdAt !== settings.updatedAt ||
    settings.usePlatformGateway ||
    !!settings.gatewayContactName ||
    !!settings.gatewayContactEmail ||
    !!settings.gatewayContactPhone ||
    !!settings.legalEntityName ||
    !!settings.legalDocument ||
    !!settings.bankInfoSummary ||
    !!settings.lgpdAcceptedAt ||
    !!settings.platformTermsAcceptedAt ||
    !!settings.submittedAt ||
    !!settings.reviewedAt ||
    !!settings.reviewNotes ||
    !!settings.asaasAccountId
  );
}

function getChargeStatusTone(charge: BillingCharge) {
  if (charge.isOverdue) {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
  }

  if (charge.status === "PAID") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }

  if (charge.status === "CANCELLED" || charge.status === "FAILED") {
    return "bg-slate-200 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300";
  }

  if (charge.status === "SCHEDULED") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300";
  }

  return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";
}

function buildPaginationPages(page: number, lastPage: number) {
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(lastPage, page + 2);

  for (let current = start; current <= end; current += 1) {
    pages.push(current);
  }

  return { pages, start, end };
}

export default function BillingPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<BillingOverviewResponse | null>(
    null,
  );
  const [form, setForm] = useState<BillingSettingsForm>(buildInitialForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<BillingTab>("charges");
  const [chargeFilters, setChargeFilters] = useState<ChargeFilters>(
    buildDefaultChargeFilters,
  );
  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [chargesLoading, setChargesLoading] = useState(true);
  const [chargesFetching, setChargesFetching] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [chargeLastPage, setChargeLastPage] = useState(1);
  const [chargeTotal, setChargeTotal] = useState(0);
  const [templateOptions, setTemplateOptions] = useState<BillingGroup[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [issueForm, setIssueForm] = useState<BillingIssueForm>(
    buildDefaultIssueForm,
  );
  const [issuing, setIssuing] = useState(false);

  const isPlatformAdmin = user?.role === "PLATFORM_ADMIN";
  const canAccess = !!user && !isPlatformAdmin;
  const canManageGateway = user?.role === "ADMIN";
  const canIssueCharges = user?.role === "ADMIN";
  const canViewTemplateCatalog = ["ADMIN", "DRIVER", "COORDINATOR"].includes(
    user?.role ?? "",
  );

  const syncFromOverview = useCallback(
    (nextOverview: BillingOverviewResponse) => {
      setOverview(nextOverview);
      setForm({
        usePlatformGateway: nextOverview.settings.usePlatformGateway,
        gatewayContactName: nextOverview.settings.gatewayContactName ?? "",
        gatewayContactEmail: nextOverview.settings.gatewayContactEmail ?? "",
        gatewayContactPhone: nextOverview.settings.gatewayContactPhone ?? "",
        legalEntityName: nextOverview.settings.legalEntityName ?? "",
        legalDocument: nextOverview.settings.legalDocument ?? "",
        bankInfoSummary: nextOverview.settings.bankInfoSummary ?? "",
        lgpdAccepted: !!nextOverview.settings.lgpdAcceptedAt,
        platformTermsAccepted: !!nextOverview.settings.platformTermsAcceptedAt,
      });
    },
    [],
  );

  const fetchOverview = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await api.get<BillingOverviewResponse>("/billing/overview");
      syncFromOverview(response.data);
    } catch (error: unknown) {
      const message = getErrorMessage(
        error,
        "Nao foi possivel carregar o modulo de boletos.",
      );
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [syncFromOverview]);

  const fetchCharges = useCallback(
    async (nextFilters: ChargeFilters = chargeFilters) => {
      try {
        setChargeError(null);
        setChargesFetching(true);

        const response = await api.get<BillingChargesResponse>(
          "/billing/charges",
          {
            params: {
              page: nextFilters.page,
              limit: 10,
              ...(nextFilters.search.trim()
                ? { search: nextFilters.search.trim() }
                : {}),
              ...(nextFilters.month ? { month: nextFilters.month } : {}),
              ...(nextFilters.status !== "ALL"
                ? { status: nextFilters.status }
                : {}),
              ...(nextFilters.templateId !== "all"
                ? { templateId: nextFilters.templateId }
                : {}),
            },
          },
        );

        setCharges(response.data.data);
        setChargeLastPage(response.data.lastPage);
        setChargeTotal(response.data.total);
      } catch (error: unknown) {
        setChargeError(
          getErrorMessage(error, "Nao foi possivel carregar os boletos."),
        );
      } finally {
        setChargesLoading(false);
        setChargesFetching(false);
      }
    },
    [chargeFilters],
  );

  const fetchTemplates = useCallback(async () => {
    if (!canViewTemplateCatalog) {
      setTemplateOptions([]);
      return;
    }

    try {
      setTemplatesLoading(true);
      const response = await api.get<BillingGroupsResponse>("/billing/templates", {
        params: {
          page: 1,
          limit: 100,
          active: true,
        },
      });

      setTemplateOptions(response.data.data);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Nao foi possivel carregar os grupos de boletos."),
      );
      setTemplateOptions([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [canViewTemplateCatalog]);

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      setChargesLoading(false);
      return;
    }

    void fetchOverview();
  }, [canAccess, fetchOverview]);

  useEffect(() => {
    if (!canAccess) {
      return;
    }

    void fetchCharges();
  }, [canAccess, fetchCharges]);

  useEffect(() => {
    if (!canAccess) {
      return;
    }

    void fetchTemplates();
  }, [canAccess, fetchTemplates]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    setIsEditingSettings(!hasBillingConfiguration(overview.settings));
  }, [overview]);

  const selectedTemplate = useMemo(
    () =>
      templateOptions.find((template) => template.id === issueForm.templateId) ??
      null,
    [issueForm.templateId, templateOptions],
  );

  const selectedChargeTemplate = useMemo(
    () =>
      templateOptions.find((template) => template.id === chargeFilters.templateId) ??
      null,
    [chargeFilters.templateId, templateOptions],
  );

  const issueLinkedStudents = useMemo(() => {
    if (issueForm.templateId === "all") {
      return templateOptions.reduce(
        (total, template) => total + template._count.students,
        0,
      );
    }

    return selectedTemplate?._count.students ?? 0;
  }, [issueForm.templateId, selectedTemplate, templateOptions]);

  const showGatewayTabs =
    overview?.settings.usePlatformGateway || isEditingSettings || form.usePlatformGateway;

  const availableTabs = useMemo(() => {
    const tabs: Array<{ id: BillingTab; label: string }> = [];

    if (canManageGateway) {
      tabs.push({ id: "company", label: "Cadastro da empresa" });
    }

    if (canIssueCharges) {
      tabs.push({ id: "issue", label: "Emissao em lote" });
    }

    tabs.push({
      id: "charges",
      label: overview?.accessScope === "company" ? "Boletos" : "Meus boletos",
    });

    return tabs;
  }, [canIssueCharges, canManageGateway, overview?.accessScope]);

  useEffect(() => {
    if (!showGatewayTabs) {
      return;
    }

    if (!availableTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(availableTabs[0]?.id ?? "charges");
    }
  }, [activeTab, availableTabs, showGatewayTabs]);

  if (isPlatformAdmin) {
    return (
      <AccessDenied description="O modulo de boletos e voltado para empresas operadoras. O dono da plataforma pode acompanhar isso em uma etapa administrativa futura." />
    );
  }

  if (!canAccess || loading) {
    return <PageTableSkeleton showAction={canManageGateway} compact />;
  }

  if (loadError) {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-2xl font-bold">Boletos</h1>
        <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
      </Card>
    );
  }

  if (!overview) {
    return <PageTableSkeleton showAction={canManageGateway} compact />;
  }

  async function handleRefreshAll() {
    await Promise.all([
      fetchOverview(),
      fetchCharges(),
      canViewTemplateCatalog ? fetchTemplates() : Promise.resolve(),
    ]);
  }

  async function handleSaveSettings() {
    setSaving(true);

    try {
      await api.patch("/billing/settings", {
        usePlatformGateway: form.usePlatformGateway,
        gatewayContactName: form.gatewayContactName,
        gatewayContactEmail: form.gatewayContactEmail,
        gatewayContactPhone: form.gatewayContactPhone,
        legalEntityName: form.legalEntityName,
        legalDocument: form.legalDocument,
        bankInfoSummary: form.bankInfoSummary,
        lgpdAccepted: form.lgpdAccepted,
        platformTermsAccepted: form.platformTermsAccepted,
      });

      toast.success("Configuracao financeira salva.");
      setIsEditingSettings(false);
      await fetchOverview();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Nao foi possivel salvar as configuracoes."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitOnboarding() {
    setSubmitting(true);

    try {
      await api.post("/billing/settings/submit-onboarding");
      toast.success("Onboarding financeiro enviado para analise.");
      await fetchOverview();
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Nao foi possivel enviar o onboarding."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIssueCharges() {
    if (!issueForm.referenceMonth) {
      toast.error("Selecione o mes de referencia.");
      return;
    }

    if (!issueForm.issueDate) {
      toast.error("Selecione a data de emissao.");
      return;
    }

    setIssuing(true);

    try {
      const response = await api.post<BillingIssueResponse>(
        "/billing/charges/issue",
        {
          referenceMonth: issueForm.referenceMonth,
          issueDate: issueForm.issueDate,
          ...(issueForm.templateId !== "all"
            ? { templateId: issueForm.templateId }
            : {}),
        },
      );

      const nextFilters: ChargeFilters = {
        ...chargeFilters,
        month: issueForm.referenceMonth,
        templateId: issueForm.templateId,
        status: "ALL",
        page: 1,
      };

      setChargeFilters(nextFilters);
      setActiveTab("charges");
      toast.success(
        response.data.skippedCount > 0
          ? `${response.data.createdCount} boleto(s) emitido(s) e ${response.data.skippedCount} ignorado(s).`
          : `${response.data.createdCount} boleto(s) emitido(s) com sucesso.`,
      );

      await Promise.all([
        fetchOverview(),
        fetchCharges(nextFilters),
        canViewTemplateCatalog ? fetchTemplates() : Promise.resolve(),
      ]);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(error, "Nao foi possivel emitir os boletos."),
      );
    } finally {
      setIssuing(false);
    }
  }

  function handleCancelSettingsEdit() {
    if (!overview) {
      return;
    }

    syncFromOverview(overview);
    setIsEditingSettings(false);
  }

  function handleStartGatewaySetup() {
    setForm((current) => ({
      ...current,
      usePlatformGateway: true,
    }));
    setIsEditingSettings(true);
    setActiveTab(canManageGateway ? "company" : "charges");
  }

  const statusTone = overview.settings.usePlatformGateway
    ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/20"
    : "border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20";

  const { pages, start, end } = buildPaginationPages(
    chargeFilters.page,
    chargeLastPage,
  );

  const issueTemplateLabel =
    issueForm.templateId === "all"
      ? "Todos os grupos ativos"
      : selectedTemplate?.name ?? "Grupo nao encontrado";
  const chargeTemplateLabel =
    chargeFilters.templateId === "all"
      ? "Todos os grupos"
      : selectedChargeTemplate?.name ?? "Grupo nao encontrado";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Financeiro"
        title="Boletos"
        description={
          !showGatewayTabs
            ? "Enquanto a empresa não usa o gateway da plataforma, esta área fica focada na explicação e no preparo do onboarding."
            : "A operação financeira é separada por etapas: cadastro da empresa, emissão em lote e acompanhamento dos boletos."
        }
        actions={
          <GhostButton onClick={() => void handleRefreshAll()}>
            <RefreshCw
              size={13}
              className={cn(chargesFetching && "animate-spin")}
            />
            Atualizar
          </GhostButton>
        }
      />

      <ModeBanner
        overview={overview}
        statusTone={statusTone}
        userRole={user?.role as UserRole | undefined}
      />

      {!showGatewayTabs ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_360px]">
          <Card className="rounded-3xl border border-border/60">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[#fff2ea] text-[#ff5c00] dark:bg-[#2d211a]">
                  <FileText className="size-5" />
                </div>
                <div>
                  <CardTitle>Como funciona o gateway</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Sem o gateway da plataforma, a experiencia fica reduzida a
                    consulta e explicacao do processo.
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="grid gap-4 md:grid-cols-2">
              {overview.tutorial.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border/60 bg-card/60 p-4"
                >
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-border/60">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[#eef6ff] text-sky-700 dark:bg-[#132533] dark:text-sky-300">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <CardTitle>
                    {canManageGateway
                      ? "Ativar gateway da plataforma"
                      : "Gateway ainda nao habilitado"}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {canManageGateway
                      ? "Quando a empresa decidir usar o gateway da plataforma, as abas de operacao financeira aparecem automaticamente."
                      : "Somente o administrador pode iniciar a configuracao do gateway da plataforma."}
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <StaticField
                label="Status atual"
                value={formatStatus(overview.settings.onboardingStatus)}
              />
              <StaticField
                label="Gateway"
                value={
                  overview.settings.usePlatformGateway
                    ? "Gateway da plataforma"
                    : "Gateway externo"
                }
              />

              {canManageGateway ? (
                <Button
                  type="button"
                  onClick={handleStartGatewaySetup}
                  className="w-full rounded-2xl bg-[#ff5c00] text-white hover:bg-[#e65300]"
                >
                  <Wallet className="mr-2 size-4" />
                  Quero usar o gateway da plataforma
                </Button>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                  Aguarde a empresa concluir o onboarding financeiro para liberar a
                  visao operacional desta area.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {availableTabs.length > 1 && (
            <div className="rounded-2xl border border-border/60 bg-background/70 p-2">
              <div className="flex flex-wrap gap-2">
                {availableTabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    active={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </TabButton>
                ))}
              </div>
            </div>
          )}

          {activeTab === "company" && canManageGateway && (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_340px]">
              <Card className="rounded-3xl border border-border/60">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Cadastro da empresa</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Depois de salvar, os dados ficam em modo somente leitura ate
                      voce clicar em editar novamente.
                    </p>
                  </div>

                  {!isEditingSettings && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsEditingSettings(true)}
                      className="rounded-2xl"
                    >
                      <PencilLine className="mr-2 size-4" />
                      Editar configuracoes
                    </Button>
                  )}
                </CardHeader>

                <CardContent className="space-y-6">
                  {isEditingSettings ? (
                    <>
                      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                        <label className="flex items-start gap-3">
                          <Checkbox
                            checked={form.usePlatformGateway}
                            onCheckedChange={(checked) =>
                              setForm((current) => ({
                                ...current,
                                usePlatformGateway: Boolean(checked),
                              }))
                            }
                          />
                          <div className="space-y-1">
                            <p className="font-medium">
                              Utilizar gateway de pagamento da plataforma
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Ao ligar esta opcao, a empresa entra no fluxo de
                              cadastro e operacao financeira por aqui.
                            </p>
                          </div>
                        </label>
                      </div>

                      {form.usePlatformGateway ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field
                            label="Responsavel financeiro"
                            value={form.gatewayContactName}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                gatewayContactName: value,
                              }))
                            }
                            placeholder="Nome de quem cuida dos recebimentos"
                          />
                          <Field
                            label="E-mail financeiro"
                            value={form.gatewayContactEmail}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                gatewayContactEmail: value,
                              }))
                            }
                            placeholder="financeiro@empresa.com.br"
                            type="email"
                          />
                          <Field
                            label="Telefone financeiro"
                            value={form.gatewayContactPhone}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                gatewayContactPhone: value,
                              }))
                            }
                            placeholder="(11) 99999-0000"
                          />
                          <Field
                            label="Razao social"
                            value={form.legalEntityName}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                legalEntityName: value,
                              }))
                            }
                            placeholder="Nome juridico da empresa"
                          />
                          <Field
                            label="Documento da empresa"
                            value={form.legalDocument}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                legalDocument: value,
                              }))
                            }
                            placeholder="CNPJ ou documento de faturamento"
                          />

                          <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium">
                              Resumo das informacoes bancarias
                            </label>
                            <Textarea
                              value={form.bankInfoSummary}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  bankInfoSummary: event.target.value,
                                }))
                              }
                              placeholder="Banco, titularidade, regras de repasse, observacoes e o que ja foi validado com a empresa."
                            />
                          </div>

                          <label className="flex items-start gap-3 rounded-2xl border border-border/60 p-4">
                            <Checkbox
                              checked={form.lgpdAccepted}
                              onCheckedChange={(checked) =>
                                setForm((current) => ({
                                  ...current,
                                  lgpdAccepted: Boolean(checked),
                                }))
                              }
                            />
                            <div className="space-y-1">
                              <p className="font-medium">
                                Aceite de protecao de dados
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Confirma que a empresa entende o tratamento de dados
                                dos pagadores e dos alunos.
                              </p>
                            </div>
                          </label>

                          <label className="flex items-start gap-3 rounded-2xl border border-border/60 p-4">
                            <Checkbox
                              checked={form.platformTermsAccepted}
                              onCheckedChange={(checked) =>
                                setForm((current) => ({
                                  ...current,
                                  platformTermsAccepted: Boolean(checked),
                                }))
                              }
                            />
                            <div className="space-y-1">
                              <p className="font-medium">
                                Aceite dos termos operacionais
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Confirma repasse, responsabilidade sobre cobranca
                                e uso do gateway da plataforma.
                              </p>
                            </div>
                          </label>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
                          Se o gateway permanecer desligado, a tela volta para o
                          modo explicativo.
                        </div>
                      )}

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCancelSettingsEdit}
                          className="rounded-2xl"
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void handleSaveSettings()}
                          disabled={saving}
                          className="rounded-2xl bg-[#ff5c00] text-white hover:bg-[#e65300]"
                        >
                          {saving ? "Salvando..." : "Salvar configuracao"}
                        </Button>
                        {form.usePlatformGateway && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleSubmitOnboarding()}
                            disabled={submitting}
                            className="rounded-2xl"
                          >
                            <SendHorizontal className="mr-2 size-4" />
                            {submitting ? "Enviando..." : "Enviar onboarding"}
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <StaticField
                          label="Gateway"
                          value={
                            form.usePlatformGateway
                              ? "Gateway da plataforma"
                              : "Gateway externo"
                          }
                        />
                        <StaticField
                          label="Status do onboarding"
                          value={formatStatus(overview.settings.onboardingStatus)}
                        />
                        <StaticField
                          label="Responsavel financeiro"
                          value={form.gatewayContactName || "Nao informado"}
                        />
                        <StaticField
                          label="E-mail financeiro"
                          value={form.gatewayContactEmail || "Nao informado"}
                        />
                        <StaticField
                          label="Telefone financeiro"
                          value={form.gatewayContactPhone || "Nao informado"}
                        />
                        <StaticField
                          label="Razao social"
                          value={form.legalEntityName || "Nao informado"}
                        />
                        <StaticField
                          label="Documento da empresa"
                          value={form.legalDocument || "Nao informado"}
                        />
                        <StaticField
                          label="Conta Asaas"
                          value={
                            overview.settings.asaasAccountId || "Nao vinculada"
                          }
                        />
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium">
                            Resumo das informacoes bancarias
                          </label>
                          <div className="min-h-24 rounded-2xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                            {form.bankInfoSummary ||
                              "Nenhuma informacao cadastrada."}
                          </div>
                        </div>
                        <StaticField
                          label="Aceite LGPD"
                          value={form.lgpdAccepted ? "Aceito" : "Pendente"}
                        />
                        <StaticField
                          label="Termos operacionais"
                          value={
                            form.platformTermsAccepted ? "Aceito" : "Pendente"
                          }
                        />
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleSubmitOnboarding()}
                          disabled={submitting}
                          className="rounded-2xl"
                        >
                          <SendHorizontal className="mr-2 size-4" />
                          {submitting ? "Enviando..." : "Enviar onboarding"}
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border border-border/60">
                <CardHeader className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-2xl bg-[#eef6ff] text-sky-700 dark:bg-[#132533] dark:text-sky-300">
                      <ShieldCheck className="size-5" />
                    </div>
                    <div>
                      <CardTitle>Checklist do onboarding</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        A empresa avanca para analise quando o basico estiver
                        preenchido.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {overview.onboardingChecklist.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-2xl border border-border/60 px-4 py-3"
                    >
                      <span className="text-sm">{item.label}</span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
                          item.done
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                        )}
                      >
                        {item.done ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : (
                          <Clock3 className="size-3.5" />
                        )}
                        {item.done ? "Concluido" : "Pendente"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "issue" && canIssueCharges && (
            <Card className="rounded-3xl border border-border/60">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#fff2ea] text-[#ff5c00] dark:bg-[#2d211a]">
                    <CalendarClock className="size-5" />
                  </div>
                  <div>
                    <CardTitle>Emissao em lote</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      O valor e o vencimento saem do grupo vinculado em cada
                      aluno. Aqui voce define o mes e a data de emissao do lote.
                    </p>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-5">
                {templateOptions.length === 0 && !templatesLoading ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-5 text-sm text-muted-foreground">
                    Cadastre grupos de boletos e vincule-os aos alunos para
                    liberar a emissao em lote.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Grupo de boletos
                        </label>
                        <Select
                          value={issueForm.templateId}
                          onValueChange={(value) =>
                            setIssueForm((current) => ({
                              ...current,
                              templateId: value ?? "all",
                            }))
                          }
                        >
                          <SelectTrigger className="h-11 rounded-2xl">
                            <SelectValue placeholder="Todos os grupos ativos">
                              {issueTemplateLabel}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              Todos os grupos ativos
                            </SelectItem>
                            {templateOptions.map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <Field
                        label="Mes de referencia"
                        value={issueForm.referenceMonth}
                        onChange={(value) =>
                          setIssueForm((current) => ({
                            ...current,
                            referenceMonth: value,
                          }))
                        }
                        placeholder="AAAA-MM"
                        type="month"
                      />

                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Data de emissao
                        </label>
                        <DatePicker
                          value={issueForm.issueDate}
                          onChange={(value) =>
                            setIssueForm((current) => ({
                              ...current,
                              issueDate: value,
                            }))
                          }
                          placeholder="Selecione a data de emissao"
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
                      <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
                        <p className="text-sm font-medium">Resumo da emissao</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <StaticField
                            label="Grupo selecionado"
                            value={issueTemplateLabel}
                          />
                          <StaticField
                            label="Mes"
                            value={formatMonthLabel(issueForm.referenceMonth)}
                          />
                          <StaticField
                            label="Data de emissao"
                            value={formatDate(issueForm.issueDate)}
                          />
                          <StaticField
                            label="Vinculos encontrados"
                            value={`${issueLinkedStudents} aluno(s) cadastrado(s)`}
                          />
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                        <p className="text-sm font-medium">Regra aplicada</p>
                        <p className="mt-3 text-sm text-muted-foreground">
                          {selectedTemplate
                            ? `${formatCurrency(selectedTemplate.amountCents)} - vencimento no dia ${selectedTemplate.dueDay} - ${billingRecurrenceLabels[selectedTemplate.recurrence]}`
                            : "Quando varios grupos forem emitidos juntos, cada aluno herda o valor e o vencimento do proprio grupo."}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-muted-foreground">
                        Alunos sem grupo ativo ou com boleto ja emitido para o
                        mesmo mes serao ignorados automaticamente.
                      </p>

                      <Button
                        type="button"
                        onClick={() => void handleIssueCharges()}
                        disabled={issuing || templateOptions.length === 0}
                        className="rounded-2xl bg-[#ff5c00] text-white hover:bg-[#e65300]"
                      >
                        {issuing ? (
                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                        ) : (
                          <SendHorizontal className="mr-2 size-4" />
                        )}
                        {issuing ? "Emitindo..." : "Emitir lote"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === "charges" && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {overview.summaryCards.map((card) => (
                  <Card
                    key={card.id}
                    className="rounded-2xl border border-border/60"
                  >
                    <CardContent className="space-y-3 p-5">
                      <p className="text-sm text-muted-foreground">
                        {card.label}
                      </p>
                      <p className="text-3xl font-bold tracking-tight">
                        {card.value}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {card.helper}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="rounded-3xl border border-border/60">
                <CardHeader className="space-y-4">
                  <div>
                    <CardTitle>
                      {overview.accessScope === "company"
                        ? "Boletos emitidos"
                        : "Meus boletos"}
                    </CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Busca por aluno, pagador, grupo e mes, com filtros de
                      status mais claros e uma tabela mais limpa.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {primaryChargeStatusTabs.map((status) => (
                      <TabButton
                        key={status}
                        active={chargeFilters.status === status}
                        onClick={() =>
                          setChargeFilters((current) => ({
                            ...current,
                            status,
                            page: 1,
                          }))
                        }
                        compact
                      >
                        {getChargeStatusFilterLabel(status)}
                      </TabButton>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Buscar</label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={chargeFilters.search}
                          onChange={(event) =>
                            setChargeFilters((current) => ({
                              ...current,
                              search: event.target.value,
                              page: 1,
                            }))
                          }
                          placeholder="Aluno, pagador, grupo ou referencia"
                          className="pl-9"
                        />
                      </div>
                    </div>

                    <Field
                      label="Mes"
                      value={chargeFilters.month}
                      onChange={(value) =>
                        setChargeFilters((current) => ({
                          ...current,
                          month: value,
                          page: 1,
                        }))
                      }
                      placeholder="AAAA-MM"
                      type="month"
                    />

                    {canViewTemplateCatalog ? (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Grupo de boletos
                        </label>
                        <Select
                          value={chargeFilters.templateId}
                          onValueChange={(value) =>
                            setChargeFilters((current) => ({
                              ...current,
                              templateId: value ?? "all",
                              page: 1,
                            }))
                          }
                        >
                          <SelectTrigger className="h-11 rounded-2xl">
                            <SelectValue placeholder="Todos os grupos">
                              {chargeTemplateLabel}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos os grupos</SelectItem>
                            {templateOptions.map((template) => (
                              <SelectItem key={template.id} value={template.id}>
                                {template.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <StaticField
                        label="Status em foco"
                        value={getChargeStatusFilterLabel(chargeFilters.status)}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      {chargesFetching
                        ? "Atualizando lista..."
                        : `${chargeTotal} boleto(s) encontrado(s)`}
                      {selectedChargeTemplate
                        ? ` em ${selectedChargeTemplate.name}`
                        : ""}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setChargeFilters(buildDefaultChargeFilters());
                      }}
                      className="rounded-2xl"
                    >
                      Limpar filtros
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {chargeError ? (
                    <div className="rounded-2xl border border-dashed border-rose-300 bg-rose-50/80 p-5 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200">
                      {chargeError}
                    </div>
                  ) : chargesLoading ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
                      Carregando boletos...
                    </div>
                  ) : charges.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
                      Nenhum boleto encontrado com os filtros atuais. Ajuste o
                      mes, o grupo ou o status.
                    </div>
                  ) : (
                    <>
                      <div className="overflow-hidden rounded-2xl border border-border/60">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Aluno e pagador</TableHead>
                              <TableHead>Grupo</TableHead>
                              <TableHead>Valor</TableHead>
                              <TableHead>Emissao</TableHead>
                              <TableHead>Vencimento</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Pagamento</TableHead>
                              <TableHead>Boleto</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {charges.map((charge) => (
                              <TableRow key={charge.id}>
                                <TableCell className="align-top">
                                  <div className="space-y-1">
                                    <p className="font-medium">
                                      {charge.student?.name ??
                                        charge.recipientName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {charge.customer?.name ??
                                        charge.recipientName}
                                      {charge.student?.registration
                                        ? ` - ${charge.student.registration}`
                                        : ""}
                                    </p>
                                    {charge.recipientEmail && (
                                      <p className="text-xs text-muted-foreground">
                                        {charge.recipientEmail}
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="align-top">
                                  <div className="space-y-1">
                                    <p className="font-medium">
                                      {charge.template?.name ?? "Sem grupo"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {charge.template
                                        ? billingRecurrenceLabels[
                                            charge.template.recurrence
                                          ]
                                        : charge.description}
                                    </p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {formatCurrency(charge.amountCents)}
                                </TableCell>
                                <TableCell>{formatDate(charge.issueDate)}</TableCell>
                                <TableCell>{formatDate(charge.dueDate)}</TableCell>
                                <TableCell>
                                  <span
                                    className={cn(
                                      "inline-flex rounded-full px-3 py-1 text-xs font-medium",
                                      getChargeStatusTone(charge),
                                    )}
                                  >
                                    {charge.isOverdue
                                      ? "Em atraso"
                                      : formatStatus(charge.status)}
                                  </span>
                                </TableCell>
                                <TableCell>{formatDate(charge.paidAt)}</TableCell>
                                <TableCell>
                                  {charge.bankSlipUrl ? (
                                    <a
                                      href={charge.bankSlipUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium hover:bg-muted"
                                    >
                                      Abrir
                                      <ExternalLink className="size-3.5" />
                                    </a>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      Pendente
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              onClick={() =>
                                setChargeFilters((current) => ({
                                  ...current,
                                  page: current.page - 1,
                                }))
                              }
                              disabled={chargeFilters.page === 1}
                            />
                          </PaginationItem>

                          {start > 1 && (
                            <>
                              <PaginationItem>
                                <PaginationLink
                                  onClick={() =>
                                    setChargeFilters((current) => ({
                                      ...current,
                                      page: 1,
                                    }))
                                  }
                                >
                                  1
                                </PaginationLink>
                              </PaginationItem>
                              {start > 2 && <span className="px-2">...</span>}
                            </>
                          )}

                          {pages.map((currentPage) => (
                            <PaginationItem key={currentPage}>
                              <PaginationLink
                                isActive={currentPage === chargeFilters.page}
                                onClick={() =>
                                  setChargeFilters((current) => ({
                                    ...current,
                                    page: currentPage,
                                  }))
                                }
                              >
                                {currentPage}
                              </PaginationLink>
                            </PaginationItem>
                          ))}

                          {end < chargeLastPage && (
                            <>
                              {end < chargeLastPage - 1 && (
                                <span className="px-2">...</span>
                              )}
                              <PaginationItem>
                                <PaginationLink
                                  onClick={() =>
                                    setChargeFilters((current) => ({
                                      ...current,
                                      page: chargeLastPage,
                                    }))
                                  }
                                >
                                  {chargeLastPage}
                                </PaginationLink>
                              </PaginationItem>
                            </>
                          )}

                          <PaginationItem>
                            <PaginationNext
                              onClick={() =>
                                setChargeFilters((current) => ({
                                  ...current,
                                  page: current.page + 1,
                                }))
                              }
                              disabled={chargeFilters.page === chargeLastPage}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModeBanner({
  overview,
  statusTone,
  userRole,
}: {
  overview: BillingOverviewResponse;
  statusTone: string;
  userRole?: UserRole;
}) {
  return (
    <Card className={`overflow-hidden border ${statusTone}`}>
      <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="size-4 text-[#ff5c00]" />
            <span>
              Modo atual:{" "}
              {overview.settings.usePlatformGateway
                ? "Gateway da plataforma"
                : "Gateway externo"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Perfil atual: {roleLabels[userRole ?? "USER"] ?? userRole}. Status do
            onboarding: {formatStatus(overview.settings.onboardingStatus)}.
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm text-muted-foreground">
          Ultima atualizacao: {formatDateTime(overview.settings.updatedAt)}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  step,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: ComponentProps<typeof Input>["type"];
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}

function StaticField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-2xl border px-4 py-2 text-sm font-medium transition-colors",
        compact ? "py-2" : "py-2.5",
        active
          ? "border-[#ff5c00] bg-[#fff2ea] text-[#ff5c00] dark:border-[#ff8a45] dark:bg-[#2b211b] dark:text-[#ffb07a]"
          : "border-border/60 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
