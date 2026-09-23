"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogIn, LogOut, Radio, ShieldAlert } from "lucide-react";
import { EmptyState, LiveDot, Panel, PanelHeader } from "../primitives";
import type { EventType, RecentEvent } from "../../types/dashboard";
import { cn } from "@/lib/utils";

type FilterKey = "ALL" | "BOARDING" | "DEBOARDING" | "DENIED";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "Tudo" },
  { key: "BOARDING", label: "Embarque" },
  { key: "DEBOARDING", label: "Desembarque" },
  { key: "DENIED", label: "Negado" },
];

const eventStyles: Record<
  EventType,
  { icon: typeof LogIn; color: string; label: string }
> = {
  BOARDING: { icon: LogIn, color: "#22c55e", label: "Embarque" },
  DEBOARDING: { icon: LogOut, color: "#0ea5e9", label: "Desembarque" },
  DENIED: { icon: ShieldAlert, color: "#ef4444", label: "Negado" },
  LEAVING: { icon: Radio, color: "#a1a1aa", label: "Saída" },
};

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function EventFeed({
  events,
  live,
}: {
  events: RecentEvent[];
  live: boolean;
}) {
  const [filter, setFilter] = useState<FilterKey>("ALL");

  const filtered =
    filter === "ALL"
      ? events
      : events.filter((event) => event.type === filter);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Leituras recentes"
        hint="Eventos de TAG registrados pelos UniHubs"
        action={<LiveDot active={live} />}
      />

      <div className="mt-3 flex flex-wrap gap-1.5 px-5">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={cn(
              "relative rounded-full px-2.5 py-1 text-[11px] transition cursor-pointer",
              filter === item.key
                ? "text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {filter === item.key && (
              <motion.span
                layoutId="feed-filter"
                className="absolute inset-0 rounded-full bg-foreground"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto unipass-scrollbar px-5 pb-5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Radio size={20} />}
            title={
              events.length === 0
                ? "Nenhuma leitura registrada ainda"
                : "Nenhum evento desse tipo"
            }
            description={
              events.length === 0
                ? "As passagens de TAG nos ônibus aparecem aqui em tempo real."
                : undefined
            }
          />
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false} mode="popLayout">
              {filtered.map((event) => {
                const style = eventStyles[event.type];
                const Icon = style.icon;

                return (
                  <motion.li
                    key={event.eventId}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", stiffness: 380, damping: 34 }}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-accent/50"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: `${style.color}1a`,
                        color: style.color,
                      }}
                    >
                      <Icon size={13} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {event.studentName ??
                          (event.rfidTag
                            ? `TAG ${event.rfidTag}`
                            : "TAG desconhecida")}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {style.label}
                        {event.busPlate ? ` · ${event.busPlate}` : ""}
                        {event.deviceLabel ? ` · ${event.deviceLabel}` : ""}
                      </p>
                    </div>

                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {formatTime(event.at)}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Panel>
  );
}
