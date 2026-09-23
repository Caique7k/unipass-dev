"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle, BellRing, Info, ShieldAlert, Wallet } from "lucide-react";
import { AnimatedNumber, EmptyState, Panel, PanelHeader } from "../primitives";
import type { DashboardAlert, DashboardMetrics } from "../../types/dashboard";

function formatCents(amountCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
}

const alertStyles = {
  info: { color: "#0ea5e9", icon: Info },
  warning: { color: "#f59e0b", icon: AlertTriangle },
  danger: { color: "#ef4444", icon: ShieldAlert },
} as const;

export function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Atenção"
        hint={
          alerts.length === 0
            ? "Nada pendente no momento"
            : `${alerts.length} ${alerts.length === 1 ? "ponto" : "pontos"} para revisar`
        }
      />

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto unipass-scrollbar px-5 pb-5">
        {alerts.length === 0 ? (
          <EmptyState
            title="Operação sem pendências"
            description="Dispositivos reportando, leituras aceitas e cobranças em dia."
          />
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert, index) => {
              const style = alertStyles[alert.level];
              const Icon = style.icon;

              return (
                <motion.li
                  key={alert.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link
                    href={alert.href}
                    className="flex gap-3 rounded-2xl border px-3 py-2.5 transition hover:bg-accent/40"
                    style={{ borderColor: `${style.color}44` }}
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: `${style.color}1a`,
                        color: style.color,
                      }}
                    >
                      <Icon size={12} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{alert.title}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {alert.description}
                      </p>
                    </div>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

export function ConfirmationsPanel({
  confirmations,
}: {
  confirmations: DashboardMetrics["confirmations"];
}) {
  const { prompts, willGo, willNotGo } = confirmations;
  const totalPrompts =
    prompts.pending +
    prompts.dispatched +
    prompts.answered +
    prompts.expired +
    prompts.failed;

  const answeredRate =
    totalPrompts > 0 ? Math.round((prompts.answered / totalPrompts) * 100) : 0;

  const rows = [
    { label: "Aguardando envio", value: prompts.pending, color: "#a1a1aa" },
    { label: "Enviados", value: prompts.dispatched, color: "#0ea5e9" },
    { label: "Respondidos", value: prompts.answered, color: "#22c55e" },
    { label: "Expirados", value: prompts.expired, color: "#f59e0b" },
    { label: "Falharam", value: prompts.failed, color: "#ef4444" },
  ];

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Confirmações de presença"
        hint="Avisos de horário enviados hoje"
        action={
          <Link
            href="/dashboard/app"
            className="text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            App
          </Link>
        }
      />

      <div className="mt-4 flex-1 px-5 pb-5">
        {totalPrompts === 0 ? (
          <EmptyState
            icon={<BellRing size={20} />}
            title="Nenhum aviso enviado hoje"
            description="Os avisos saem automaticamente antes de cada horário de rota."
          />
        ) : (
          <>
            <div className="flex items-end gap-3">
              <AnimatedNumber
                value={answeredRate}
                format={(n) => `${Math.round(n)}%`}
                className="text-3xl font-semibold leading-none"
              />
              <p className="pb-0.5 text-xs text-muted-foreground">
                dos {totalPrompts} avisos respondidos
              </p>
            </div>

            <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-border/60">
              {rows
                .filter((row) => row.value > 0)
                .map((row) => (
                  <motion.span
                    key={row.label}
                    initial={{ flexGrow: 0 }}
                    animate={{ flexGrow: row.value }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    style={{ backgroundColor: row.color, flexBasis: 0 }}
                  />
                ))}
            </div>

            <ul className="mt-4 space-y-1.5">
              {rows
                .filter((row) => row.value > 0)
                .map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="ml-auto font-medium tabular-nums">
                      {row.value}
                    </span>
                  </li>
                ))}
            </ul>

            {willGo + willNotGo > 0 && (
              <div className="mt-4 flex gap-2 border-t border-border/60 pt-3 text-xs">
                <span className="text-muted-foreground">Respostas:</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {willGo} vão
                </span>
                <span className="font-medium text-muted-foreground">
                  {willNotGo} não vão
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

export function BillingPanel({
  billing,
}: {
  billing: NonNullable<DashboardMetrics["billing"]>;
}) {
  const cards = [
    {
      // "A vencer" e não "Em aberto": na tela de boletos, "em aberto" inclui as
      // vencidas. Aqui as duas linhas são separadas e somam o mesmo total.
      label: "A vencer",
      count: billing.openCount,
      amount: billing.openAmountCents,
      color: "#0ea5e9",
    },
    {
      label: "Vencidos",
      count: billing.overdueCount,
      amount: billing.overdueAmountCents,
      color: "#ef4444",
    },
    {
      label: "Pagos no mês",
      count: billing.paidThisMonthCount,
      amount: billing.paidThisMonthAmountCents,
      color: "#22c55e",
    },
  ];

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Financeiro"
        hint="Cobranças da empresa"
        action={
          <Link
            href="/dashboard/billing"
            className="text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Boletos
          </Link>
        }
      />

      <div className="mt-4 flex-1 px-5 pb-5">
        {cards.every((card) => card.count === 0) ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title="Nenhuma cobrança emitida"
            description="Crie um grupo de boletos e emita as cobranças do mês."
          />
        ) : (
          <ul className="space-y-2">
            {cards.map((card, index) => (
              <motion.li
                key={card.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between rounded-2xl border border-border/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-6 w-1 rounded-full"
                    style={{ backgroundColor: card.color }}
                  />
                  <div>
                    <p className="text-xs font-medium">{card.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {card.count}{" "}
                      {card.count === 1 ? "cobrança" : "cobranças"}
                    </p>
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCents(card.amount)}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
