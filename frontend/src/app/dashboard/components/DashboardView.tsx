"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Pause, Play, RefreshCw } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useDashboard } from "../../hooks/useDashboard";
import { DashboardContent } from "./DashboardContent";
import { LiveDot, Panel, SectionLabel } from "./primitives";
import { cn } from "@/lib/utils";

function formatLastUpdated(date: Date | null) {
  if (!date) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function CompanyDashboard() {
  const { user } = useAuth();
  const {
    data,
    loading,
    refreshing,
    error,
    lastUpdated,
    live,
    toggleLive,
    refresh,
  } = useDashboard();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>{user?.companyName ?? "Painel"}</SectionLabel>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-3xl">
            Visão geral
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {error && data && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Falha na última atualização
            </span>
          )}

          <button
            type="button"
            onClick={toggleLive}
            aria-pressed={live}
            title={live ? "Pausar atualização" : "Retomar atualização"}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs transition hover:border-foreground/20"
          >
            <LiveDot active={live} />
            <span className="hidden sm:inline text-muted-foreground">
              {live ? "Ao vivo" : "Pausado"}
            </span>
            {live ? <Pause size={12} /> : <Play size={12} />}
          </button>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs transition hover:border-foreground/20 disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              className={cn(refreshing && "animate-spin")}
            />
            <span className="tabular-nums text-muted-foreground">
              {formatLastUpdated(lastUpdated)}
            </span>
          </button>
        </div>
      </div>

      <DashboardContent
        data={data}
        loading={loading}
        error={error}
        live={live}
        onRetry={() => void refresh()}
      />
    </div>
  );
}

function PlaceholderPanel({
  label,
  title,
  description,
  links,
}: {
  label: string;
  title: string;
  description: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <motion.div initial="hidden" animate="show">
      <Panel className="max-w-2xl p-6">
        <SectionLabel>{label}</SectionLabel>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs transition hover:border-foreground/25"
            >
              {link.label}
              <ArrowUpRight
                size={12}
                className="transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          ))}
        </div>
      </Panel>
    </motion.div>
  );
}

export function DashboardView() {
  const { user } = useAuth();

  if (user?.role === "PLATFORM_ADMIN") {
    return (
      <PlaceholderPanel
        label="UniPass"
        title="Painel da plataforma"
        description="Este perfil representa o dono do UniPass e tem uma área separada para acompanhar as empresas cadastradas."
        links={[{ href: "/dashboard/companies", label: "Ver empresas" }]}
      />
    );
  }

  if (user?.role === "USER") {
    return (
      <PlaceholderPanel
        label="Área do aluno"
        title="Seus horários e cobranças"
        description="Este perfil ficou reservado para os próximos passos: rastreamento em tempo real, lembretes de boleto e presença de ida e volta."
        links={[
          { href: "/dashboard/billing", label: "Meus boletos" },
          { href: "/dashboard/app", label: "Aplicativo" },
        ]}
      />
    );
  }

  return <CompanyDashboard />;
}
