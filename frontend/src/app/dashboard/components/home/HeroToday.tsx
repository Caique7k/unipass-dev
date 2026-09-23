"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Bus, LogIn, LogOut, ShieldAlert } from "lucide-react";
import {
  ACCENT,
  AnimatedNumber,
  Panel,
  ProgressRing,
  SectionLabel,
  TrendPill,
} from "../primitives";
import type { DashboardMetrics } from "../../types/dashboard";

function formatToday(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(year, month - 1, day));
}

const miniStats = [
  {
    key: "boardings" as const,
    label: "Embarques",
    icon: LogIn,
    href: "/dashboard/boarding",
  },
  {
    key: "deboardings" as const,
    label: "Desembarques",
    icon: LogOut,
    href: "/dashboard/boarding",
  },
  {
    key: "denied" as const,
    label: "Negados",
    icon: ShieldAlert,
    href: "/dashboard/boarding",
  },
];

export function HeroToday({ data }: { data: DashboardMetrics }) {
  const { movement, fleet, students } = data;
  const occupancy = fleet.occupancyRate;

  return (
    <Panel className="p-5 lg:p-6">
      {/* Brilho de fundo: dá profundidade sem pesar a leitura. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
        style={{ backgroundColor: `${ACCENT}1f` }}
      />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <SectionLabel>Operação de hoje</SectionLabel>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {formatToday(data.dateKey)}
          </p>

          <div className="mt-5 flex items-end gap-3">
            <AnimatedNumber
              value={movement.onBoardNow}
              className="text-5xl font-semibold leading-none tracking-tight lg:text-6xl"
            />
            <div className="pb-1">
              <p className="text-sm font-medium">a bordo agora</p>
              <p className="text-xs text-muted-foreground">
                embarques menos desembarques do dia
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/students"
              className="group inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs transition hover:border-foreground/25"
            >
              <span className="font-semibold tabular-nums">
                {students.transportedToday}
              </span>
              <span className="text-muted-foreground">
                de {students.active} alunos ativos transportados
              </span>
              <ArrowUpRight
                size={12}
                className="text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {occupancy !== null ? (
            <ProgressRing
              value={occupancy}
              label={`${occupancy}%`}
              caption="ocupação"
            />
          ) : (
            <div className="flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-full border border-dashed border-border/70 px-3 text-center">
              <Bus size={18} className="text-muted-foreground" />
              <span className="mt-1 text-[10px] leading-tight text-muted-foreground">
                sem capacidade cadastrada
              </span>
            </div>
          )}

          <div className="grid gap-2">
            {miniStats.map((stat, index) => {
              const metric = movement[stat.key];
              const Icon = stat.icon;

              return (
                <motion.div
                  key={stat.key}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + index * 0.06 }}
                >
                  <Link
                    href={stat.href}
                    className="flex items-center gap-3 rounded-2xl border border-border/50 bg-background/50 px-3 py-2 transition hover:border-foreground/20"
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: `${ACCENT}14`,
                        color: ACCENT,
                      }}
                    >
                      <Icon size={15} />
                    </span>
                    <div className="min-w-[7.5rem]">
                      <div className="flex items-baseline gap-2">
                        <AnimatedNumber
                          value={metric.value}
                          className="text-lg font-semibold leading-none"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {stat.label}
                        </span>
                      </div>
                      <TrendPill delta={metric.delta} />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
