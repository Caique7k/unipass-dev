"use client";

import { AnimatePresence, motion } from "motion/react";
import { LogIn, LogOut } from "lucide-react";
import { Panel, PanelHeader } from "../../components/primitives";
import type { MyTripEvent } from "../types/my-trip";

// As mesmas cores de "Leituras recentes", na Visão geral.
const eventStyles = {
  BOARDING: { icon: LogIn, color: "#22c55e", label: "Embarque" },
  DEBOARDING: { icon: LogOut, color: "#0ea5e9", label: "Desembarque" },
} as const;

export function formatEventTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Os eventos de hoje, com o mais recente em cima. */
export function TripEventList({ events }: { events: MyTripEvent[] }) {
  if (events.length === 0) return null;

  return (
    <Panel className="pb-4">
      <PanelHeader title="Hoje" hint="Seus embarques e desembarques" />

      <ul className="mt-3 space-y-1 px-3">
        <AnimatePresence initial={false}>
          {[...events].reverse().map((event) => {
            const { icon: Icon, color, label } = eventStyles[event.type];

            return (
              <motion.li
                key={`${event.type}-${event.at}`}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className="flex items-center gap-3 rounded-xl px-2 py-2.5"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${color}1a`, color }}
                >
                  <Icon size={17} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {event.busPlate
                      ? `Ônibus ${event.busPlate}`
                      : "Ônibus não informado"}
                  </p>
                </div>

                <span className="shrink-0 text-base font-semibold tabular-nums">
                  {formatEventTime(event.at)}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </Panel>
  );
}
