"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bus, Clock, LogOut, type LucideIcon } from "lucide-react";
import { Panel, SectionLabel } from "../../components/primitives";
import type { MyTrip } from "../types/my-trip";
import { formatEventTime } from "./TripEventList";

type TripState = "onBoard" | "offBoard" | "none";

const states: Record<
  TripState,
  { title: string; hint: string; color: string; icon: LucideIcon }
> = {
  onBoard: {
    title: "A bordo",
    hint: "Seu embarque foi registrado.",
    color: "#22c55e",
    icon: Bus,
  },
  offBoard: {
    title: "Fora do ônibus",
    hint: "Seu desembarque foi registrado.",
    color: "#0ea5e9",
    icon: LogOut,
  },
  none: {
    title: "Nenhum embarque hoje",
    hint: "Passe sua TAG no ônibus e o embarque aparece aqui.",
    color: "#a1a1aa",
    icon: Clock,
  },
};

function tripState(trip: MyTrip): TripState {
  if (trip.events.length === 0) return "none";

  return trip.onBoard ? "onBoard" : "offBoard";
}

export function TripStatusCard({ trip }: { trip: MyTrip }) {
  const reduceMotion = useReducedMotion();
  const state = tripState(trip);
  const { title, hint, color, icon: Icon } = states[state];
  const lastEvent = trip.events.at(-1);

  return (
    <Panel className="p-6 sm:p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl transition-colors duration-500"
        style={{ backgroundColor: `${color}2e` }}
      />

      <div className="relative" aria-live="polite">
        {/* A chave é o estado: só a mudança anima, as recargas não piscam. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span
              className="flex h-16 w-16 items-center justify-center rounded-3xl"
              style={{ backgroundColor: `${color}1f`, color }}
            >
              <Icon size={30} />
            </span>

            <p className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
              {title}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>
          </motion.div>
        </AnimatePresence>

        {lastEvent && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <Detail
              label={lastEvent.type === "BOARDING" ? "Embarque" : "Desembarque"}
              value={formatEventTime(lastEvent.at)}
            />
            <Detail label="Ônibus" value={lastEvent.busPlate} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/50 bg-background/50 px-4 py-3">
      <SectionLabel>{label}</SectionLabel>
      {value ? (
        <p className="mt-1 break-words text-xl font-semibold leading-tight tabular-nums">
          {value}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Não informado</p>
      )}
    </div>
  );
}
