"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { motion } from "motion/react";
import {
  ArrowRightLeft,
  BookUser,
  Building2,
  Bus,
  Clock3,
  Cpu,
  Mail,
  Phone,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { CompanyPlan, companyPlanMeta } from "@/lib/company-plans";
import api from "@/services/api";
import { CompaniesSkeleton } from "../components/DashboardSkeletons";
import {
  PageHeader,
  PrimaryButton,
  SearchField,
  StatusBadge,
  Toolbar,
} from "../components/page-kit";
import {
  ACCENT,
  AnimatedNumber,
  EmptyState,
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

type Company = {
  id: string;
  name: string;
  cnpj: string;
  emailDomain: string;
  plan: CompanyPlan;
  contactName: string | null;
  contactPhone: string | null;
  createdAt: string;
  pendingPlanChangeRequest: PendingPlanChangeRequest | null;
  _count: {
    users: number;
    students: number;
    buses: number;
    devices: number;
  };
};

type ApplyPlanResponse = {
  message: string;
  company: Company;
};

const planTones: Record<CompanyPlan, "neutral" | "info" | "accent"> = {
  ESSENTIAL: "neutral",
  GROWTH: "info",
  SCALE: "accent",
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

function formatPhone(value?: string | null) {
  if (!value) return "Telefone não informado";

  const digits = value.replace(/\D/g, "").replace(/^55/, "").slice(0, 11);

  if (!digits) return "Telefone não informado";
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sem data";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function CompaniesPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "PLATFORM_ADMIN";

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [applyingCompanyId, setApplyingCompanyId] = useState<string | null>(
    null,
  );

  const fetchCompanies = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await api.get<Company[]>("/companies", { signal });

      setCompanies(response.data);
    } catch (error: unknown) {
      if (axios.isCancel(error)) return;

      toast.error(
        getErrorMessage(error, "Não foi possível carregar as empresas."),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isPlatformAdmin) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    void Promise.resolve().then(() => fetchCompanies(controller.signal));

    return () => controller.abort();
  }, [isPlatformAdmin, fetchCompanies]);

  const pendingCompanies = useMemo(
    () =>
      [...companies]
        .filter((company) => company.pendingPlanChangeRequest)
        .sort((left, right) => {
          const leftDate = new Date(
            left.pendingPlanChangeRequest?.requestedAt ?? left.createdAt,
          ).getTime();
          const rightDate = new Date(
            right.pendingPlanChangeRequest?.requestedAt ?? right.createdAt,
          ).getTime();

          return rightDate - leftDate;
        }),
    [companies],
  );

  const totals = useMemo(
    () =>
      companies.reduce(
        (acc, company) => {
          acc.users += company._count.users;
          acc.students += company._count.students;
          acc.buses += company._count.buses;
          acc.devices += company._count.devices;
          return acc;
        },
        { users: 0, students: 0, buses: 0, devices: 0 },
      ),
    [companies],
  );

  const filteredCompanies = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return companies;

    return companies.filter((company) =>
      `${company.name} ${company.emailDomain} ${company.cnpj}`
        .toLowerCase()
        .includes(term),
    );
  }, [companies, search]);

  async function handleApplyRequestedPlan(companyId: string) {
    try {
      setApplyingCompanyId(companyId);

      const response = await api.patch<ApplyPlanResponse>(
        `/companies/${companyId}/apply-requested-plan`,
      );

      setCompanies((current) =>
        current.map((company) =>
          company.id === response.data.company.id
            ? response.data.company
            : company,
        ),
      );

      toast.success(response.data.message);
    } catch (error: unknown) {
      toast.error(
        getErrorMessage(
          error,
          "Não foi possível aplicar o plano solicitado agora.",
        ),
      );
    } finally {
      setApplyingCompanyId(null);
    }
  }

  if (!isPlatformAdmin) {
    return (
      <AccessDenied description="Somente o dono da plataforma pode acessar a visão global de empresas e pendências de plano." />
    );
  }

  if (loading) {
    return <CompaniesSkeleton />;
  }

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <PageHeader
        eyebrow="Plataforma"
        title="Empresas"
        description="Carteira de clientes da UniPass, planos ativos e pedidos de troca em aberto."
        meta={
          pendingCompanies.length > 0 ? (
            <StatusBadge tone="warning" dot>
              {pendingCompanies.length}{" "}
              {pendingCompanies.length === 1 ? "pendência" : "pendências"}
            </StatusBadge>
          ) : (
            <StatusBadge tone="success" dot>
              sem pendências
            </StatusBadge>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Empresas"
          value={companies.length}
          icon={<Building2 size={15} />}
        />
        <MetricCard
          label="Pendências"
          value={pendingCompanies.length}
          icon={<Clock3 size={15} />}
        />
        <MetricCard
          label="Usuários"
          value={totals.users}
          icon={<Users size={15} />}
        />
        <MetricCard
          label="Alunos"
          value={totals.students}
          icon={<BookUser size={15} />}
        />
        <MetricCard
          label="UniHubs"
          value={totals.devices}
          icon={<Cpu size={15} />}
        />
      </div>

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Solicitações pendentes
          </h2>
          <p className="text-xs text-muted-foreground">
            Aparecem assim que o administrador da empresa pede a troca de plano.
          </p>
        </div>

        {pendingCompanies.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Clock3 size={22} />}
              title="Nenhuma pendência de plano no momento"
              description="Quando uma empresa solicitar mudança, o pedido aparece aqui com os contatos para tratar o assunto."
            />
          </Panel>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {pendingCompanies.map((company) => {
              const request = company.pendingPlanChangeRequest!;

              return (
                <Panel
                  key={company.id}
                  className="p-5"
                  style={{ borderColor: `${ACCENT}44` }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <StatusBadge tone="warning" dot>
                        Pendente
                      </StatusBadge>
                      <h3 className="mt-2 truncate text-lg font-semibold tracking-tight">
                        {company.name}
                      </h3>
                      <p className="truncate text-xs text-muted-foreground">
                        @{company.emailDomain} · {formatCnpj(company.cnpj)}
                      </p>
                    </div>

                    <div className="text-right">
                      <SectionLabel>Solicitado em</SectionLabel>
                      <p className="mt-0.5 text-xs font-medium">
                        {formatDateTime(request.requestedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: `${ACCENT}14`,
                        color: ACCENT,
                      }}
                    >
                      <ArrowRightLeft size={16} />
                    </span>
                    <div className="min-w-0">
                      <SectionLabel>Mudança solicitada</SectionLabel>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {companyPlanMeta[request.currentPlan].label}
                        <ArrowRightLeft
                          size={12}
                          className="text-muted-foreground"
                        />
                        {companyPlanMeta[request.requestedPlan].label}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <ContactCard
                      icon={<Users size={13} />}
                      label="Responsável da empresa"
                      primary={
                        company.contactName || "Responsável não informado"
                      }
                      secondary={formatPhone(company.contactPhone)}
                    />
                    <ContactCard
                      icon={<Mail size={13} />}
                      label="Quem solicitou"
                      primary={
                        request.requestedByName || "Administrador da empresa"
                      }
                      secondary={
                        request.requestedByEmail || "E-mail não informado"
                      }
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {company.contactPhone && (
                      <a
                        href={`tel:${company.contactPhone}`}
                        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border/60 px-3.5 text-sm transition hover:border-foreground/25 hover:bg-accent/50"
                      >
                        <Phone size={14} />
                        Ligar
                      </a>
                    )}

                    {request.requestedByEmail && (
                      <a
                        href={`mailto:${request.requestedByEmail}`}
                        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-border/60 px-3.5 text-sm transition hover:border-foreground/25 hover:bg-accent/50"
                      >
                        <Mail size={14} />
                        Falar com solicitante
                      </a>
                    )}

                    <PrimaryButton
                      onClick={() => void handleApplyRequestedPlan(company.id)}
                      disabled={applyingCompanyId === company.id}
                    >
                      {applyingCompanyId === company.id
                        ? "Aplicando..."
                        : "Aplicar plano solicitado"}
                    </PrimaryButton>
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Empresas cadastradas
            </h2>
            <p className="text-xs text-muted-foreground">
              Panorama geral da base ativa da plataforma.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredCompanies.length} de {companies.length}
          </span>
        </div>

        <Toolbar>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome, domínio ou CNPJ..."
          />
        </Toolbar>

        {filteredCompanies.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Building2 size={22} />}
              title="Nenhuma empresa encontrada"
              description={`Nada corresponde a "${search}".`}
            />
          </Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCompanies.map((company) => (
              <Panel key={company.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold tracking-tight">
                      {company.name}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">
                      @{company.emailDomain}
                    </p>
                  </div>

                  <StatusBadge tone={planTones[company.plan]}>
                    {companyPlanMeta[company.plan].label}
                  </StatusBadge>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {formatCnpj(company.cnpj)}
                </p>

                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-border/50 pt-3">
                  <CountCell
                    label="Usuários"
                    value={company._count.users}
                    icon={<Users size={12} />}
                  />
                  <CountCell
                    label="Alunos"
                    value={company._count.students}
                    icon={<BookUser size={12} />}
                  />
                  <CountCell
                    label="Ônibus"
                    value={company._count.buses}
                    icon={<Bus size={12} />}
                  />
                  <CountCell
                    label="UniHubs"
                    value={company._count.devices}
                    icon={<Cpu size={12} />}
                  />
                </div>

                {company.pendingPlanChangeRequest && (
                  <div className="mt-3">
                    <StatusBadge tone="warning" dot>
                      Pedido de troca em aberto
                    </StatusBadge>
                  </div>
                )}

                {company.contactPhone && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone size={12} />
                    {formatPhone(company.contactPhone)}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </section>
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

function ContactCard({
  icon,
  label,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/50 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <SectionLabel>{label}</SectionLabel>
      </div>
      <p className="mt-1 truncate text-sm font-medium" title={primary}>
        {primary}
      </p>
      <p className="truncate text-xs text-muted-foreground" title={secondary}>
        {secondary}
      </p>
    </div>
  );
}

function CountCell({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <span className="flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
      </span>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
