"use client";

import { useRouter } from "next/navigation";
import { Radio, Users, UsersRound, Wifi } from "lucide-react";
import {
  ACCENT,
  AnimatedNumber,
  Panel,
  SectionLabel,
  Sparkline,
  TrendPill,
} from "../primitives";
import type { DashboardMetrics } from "../../types/dashboard";

export function KpiRow({ data }: { data: DashboardMetrics }) {
  const router = useRouter();
  const { series, students, movement, fleet } = data;

  const cards = [
    {
      key: "students",
      label: "Alunos ativos",
      value: students.active,
      footer:
        students.createdToday > 0 ? (
          <TrendPill delta={students.createdToday} suffix="novos hoje" />
        ) : (
          <span className="text-xs text-muted-foreground">
            nenhum cadastro hoje
          </span>
        ),
      spark: series.map((point) => point.students),
      icon: Users,
      href: "/dashboard/students",
    },
    {
      key: "transported",
      label: "Alunos transportados hoje",
      value: movement.transported.value,
      footer: <TrendPill delta={movement.transported.delta} />,
      spark: series.map((point) => point.students),
      icon: UsersRound,
      href: "/dashboard/boarding",
    },
    {
      key: "reads",
      label: "Leituras de TAG hoje",
      value:
        movement.boardings.value +
        movement.deboardings.value +
        movement.denied.value,
      footer: (
        <span className="text-xs text-muted-foreground">
          {movement.denied.value} negada
          {movement.denied.value === 1 ? "" : "s"}
        </span>
      ),
      spark: series.map(
        (point) => point.boardings + point.deboardings + point.denied,
      ),
      icon: Radio,
      href: "/dashboard/boarding",
    },
    {
      key: "devices",
      label: "UniHubs online",
      value: fleet.devicesOnline,
      footer: (
        <span className="text-xs text-muted-foreground">
          de {fleet.devices} dispositivo
          {fleet.devices === 1 ? "" : "s"} ativo
          {fleet.devices === 1 ? "" : "s"}
        </span>
      ),
      spark: [],
      icon: Wifi,
      href: "/dashboard/devices",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <Panel
            key={card.key}
            interactive
            onClick={() => router.push(card.href)}
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="group p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <SectionLabel>{card.label}</SectionLabel>
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-110"
                style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
              >
                <Icon size={14} />
              </span>
            </div>

            <AnimatedNumber
              value={card.value}
              className="mt-3 block text-3xl font-semibold leading-none tracking-tight"
            />

            <div className="mt-1.5">{card.footer}</div>

            {card.spark.length > 1 && (
              <Sparkline values={card.spark} className="mt-3" />
            )}
          </Panel>
        );
      })}
    </div>
  );
}
