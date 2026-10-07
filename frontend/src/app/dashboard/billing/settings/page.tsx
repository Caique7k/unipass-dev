"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Building, Check, Landmark } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/app/contexts/AuthContext";
import { PageTableSkeleton } from "@/app/dashboard/components/DashboardSkeletons";
import {
  ErrorState,
  GhostButton,
  PageHeader,
  StatusBadge,
} from "@/app/dashboard/components/page-kit";
import {
  ACCENT,
  Panel,
  staggerParent,
} from "@/app/dashboard/components/primitives";
import { AccessDenied } from "@/components/AccessDenied";
import { cn } from "@/lib/utils";
import { AsaasSetup } from "./components/AsaasSetup";
import { AsaasTutorial } from "./components/AsaasTutorial";
import { useBillingGateway } from "./hooks/useBillingGateway";
import {
  gatewayStatusMeta,
  type BillingGatewayMode,
} from "./types/billing-gateway";

export default function BillingGatewayPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  if (user && !isAdmin) {
    return (
      <AccessDenied description="Só o administrador da empresa configura o gateway de cobrança." />
    );
  }

  if (!user) {
    return <PageTableSkeleton compact />;
  }

  return <BillingGatewaySettings />;
}

function BillingGatewaySettings() {
  const {
    gateway,
    loading,
    loadError,
    busy,
    reload,
    setMode,
    saveApiKey,
    testConnection,
    removeApiKey,
    configureWebhook,
  } = useBillingGateway();
  const router = useRouter();
  // Escolher Asaas abre primeiro o tutorial; só depois a configuração.
  const [showTutorial, setShowTutorial] = useState(false);

  if (loading) {
    return <PageTableSkeleton compact />;
  }

  if (loadError || !gateway) {
    return (
      <ErrorState
        message={loadError ?? "Não foi possível carregar o gateway."}
        onRetry={() => void reload()}
      />
    );
  }

  const status = gatewayStatusMeta[gateway.status];
  const isAsaas = gateway.gateway === "ASAAS";

  async function choose(mode: BillingGatewayMode) {
    try {
      await setMode(mode);
      setShowTutorial(false);
      toast.success(
        mode === "ASAAS"
          ? "Asaas escolhido. Complete a configuração abaixo."
          : "Gateway próprio mantido. Nenhuma cobrança passa pelo Asaas.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <PageHeader
        eyebrow="Financeiro"
        title="Gateway de cobrança"
        description="Escolha como sua empresa deseja emitir e gerenciar suas cobranças."
        meta={
          <StatusBadge tone={status.tone} dot>
            {status.label}
          </StatusBadge>
        }
        actions={
          <GhostButton onClick={() => router.push("/dashboard/billing")}>
            Ir para Boletos
            <ArrowRight size={13} />
          </GhostButton>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        <ChoiceCard
          icon={Building}
          title="Gateway próprio"
          description="Sua empresa já cobra por outro processo ou gateway. O UniPass registra e acompanha os boletos sem chamar o Asaas."
          selected={!isAsaas && !showTutorial}
          disabled={busy !== null}
          onSelect={() => {
            if (isAsaas) {
              void choose("EXTERNAL");
            } else {
              setShowTutorial(false);
            }
          }}
        />
        <ChoiceCard
          icon={Landmark}
          title="Asaas"
          description="Emite boleto e Pix pela conta Asaas da própria empresa e atualiza o status de cada cobrança pelo webhook."
          selected={isAsaas || showTutorial}
          disabled={busy !== null}
          onSelect={() => {
            if (!isAsaas) setShowTutorial(true);
          }}
        />
      </div>

      {gateway.pendingSteps.length > 0 && isAsaas && (
        <Panel className="px-5 py-4">
          <p className="text-sm font-medium">Falta para emitir pelo Asaas:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {gateway.pendingSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </Panel>
      )}

      {showTutorial && !isAsaas && (
        <AsaasTutorial
          busy={busy !== null}
          onConfigure={() => void choose("ASAAS")}
          onSkip={() => void choose("EXTERNAL")}
        />
      )}

      {isAsaas && (
        <>
          <AsaasSetup
            gateway={gateway}
            busy={busy}
            onSaveKey={saveApiKey}
            onTest={testConnection}
            onConfigureWebhook={configureWebhook}
            onRemove={removeApiKey}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => void choose("EXTERNAL")}
              disabled={busy !== null}
            >
              Voltar para o gateway próprio (a chave continua salva)
            </button>
            {gateway.readyToIssue && (
              <GhostButton onClick={() => router.push("/dashboard/billing")}>
                Tudo pronto: voltar para Boletos
                <ArrowRight size={13} />
              </GhostButton>
            )}
          </div>
        </>
      )}

      {!isAsaas && gateway.status === "DISABLED" && !showTutorial && (
        <Panel className="px-5 py-4 text-sm text-muted-foreground">
          A chave do Asaas (•••• {gateway.asaas.apiKeyLast4}) continua salva,
          mas nenhuma cobrança passa pelo Asaas enquanto o gateway próprio
          estiver escolhido.
        </Panel>
      )}
    </motion.div>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon: typeof Building;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "relative flex gap-4 rounded-3xl border bg-card/70 p-5 text-left transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-[color:var(--choice-accent)] bg-[color:var(--choice-bg)]"
          : "border-border/60 hover:border-foreground/25",
      )}
      style={
        {
          "--choice-accent": `${ACCENT}88`,
          "--choice-bg": `${ACCENT}0d`,
        } as React.CSSProperties
      }
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
        style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {selected && <Check size={14} style={{ color: ACCENT }} />}
        </span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}
