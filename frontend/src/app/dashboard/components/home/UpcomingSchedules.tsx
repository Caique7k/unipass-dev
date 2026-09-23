"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CalendarClock, Users } from "lucide-react";
import { ACCENT, EmptyState, Panel, PanelHeader } from "../primitives";
import type { DashboardMetrics, ScheduleType } from "../../types/dashboard";

const typeLabels: Record<ScheduleType, string> = {
  GO: "Ida",
  BACK: "Volta",
  SHIFT: "Turno",
};

function formatCountdown(minutesUntil: number) {
  if (minutesUntil <= 0) return "saindo agora";
  if (minutesUntil < 60) return `em ${minutesUntil} min`;

  const hours = Math.floor(minutesUntil / 60);
  const minutes = minutesUntil % 60;

  return minutes === 0 ? `em ${hours}h` : `em ${hours}h${minutes}`;
}

export function UpcomingSchedules({
  schedules,
}: {
  schedules: DashboardMetrics["schedules"];
}) {
  const { upcoming, totalToday, completed } = schedules;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Próximos horários"
        hint={
          totalToday === 0
            ? "Nenhum horário programado para hoje"
            : `${completed} de ${totalToday} já saíram hoje`
        }
        action={
          <Link
            href="/dashboard/routes"
            className="text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Rotas
          </Link>
        }
      />

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto unipass-scrollbar px-5 pb-5">
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={20} />}
            title={
              totalToday === 0
                ? "Sem horários hoje"
                : "Todos os horários de hoje já saíram"
            }
            description={
              totalToday === 0
                ? "Cadastre horários nas rotas para acompanhar as saídas do dia."
                : undefined
            }
          />
        ) : (
          <ol className="relative space-y-3 pl-5">
            {/* trilho da linha do tempo */}
            <span
              aria-hidden
              className="absolute left-[3px] top-2 bottom-2 w-px bg-border"
            />

            {upcoming.map((schedule, index) => {
              const isNext = index === 0;

              return (
                <motion.li
                  key={schedule.scheduleId}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative"
                >
                  <span
                    aria-hidden
                    className="absolute -left-5 top-3 h-[7px] w-[7px] rounded-full ring-4 ring-card"
                    style={{
                      backgroundColor: isNext ? ACCENT : "var(--border)",
                    }}
                  />

                  <div
                    className="rounded-2xl border px-3 py-2.5 transition"
                    style={
                      isNext
                        ? {
                            borderColor: `${ACCENT}55`,
                            backgroundColor: `${ACCENT}0d`,
                          }
                        : { borderColor: "var(--border)" }
                    }
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {schedule.departureLabel}
                      </span>
                      <span
                        className="text-[11px] font-medium"
                        style={{
                          color: isNext ? ACCENT : "var(--muted-foreground)",
                        }}
                      >
                        {formatCountdown(schedule.minutesUntil)}
                      </span>
                    </div>

                    <p className="mt-0.5 truncate text-xs font-medium">
                      {schedule.title || schedule.routeName}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border/60 px-1.5 py-0.5">
                        {typeLabels[schedule.type]}
                      </span>
                      {schedule.busPlate && <span>{schedule.busPlate}</span>}
                      <span className="inline-flex items-center gap-1">
                        <Users size={11} />
                        {schedule.studentsCount}
                      </span>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        )}
      </div>
    </Panel>
  );
}
