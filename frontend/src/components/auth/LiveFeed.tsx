"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type FeedEvent = {
  id: number;
  time: string;
  type: "BOARDING" | "DEBOARDING" | "DENIED" | "GPS";
  who: string;
  where: string;
};

const names = [
  "Ana Souza",
  "Bruno Oliveira",
  "Carla Mendes",
  "Diego Lima",
  "Helena Rocha",
  "Cartão ***3921",
  "Cartão ***0871",
];
const vehicles = ["UNI1A01", "UNI2B02", "FRT7C11", "Linha 214", "Linha 07"];
const types: FeedEvent["type"][] = [
  "BOARDING",
  "BOARDING",
  "BOARDING",
  "DEBOARDING",
  "DEBOARDING",
  "GPS",
  "DENIED",
];

function pick<T>(list: T[]) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeEvent(id: number): FeedEvent {
  const type = pick(types);
  return {
    id,
    time: new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date()),
    type,
    who: type === "GPS" ? "posição atualizada" : type === "DENIED" ? "TAG 04C3D4E5F6" : pick(names),
    where: pick(vehicles),
  };
}

const typeColor: Record<FeedEvent["type"], string> = {
  BOARDING: "text-emerald-600 dark:text-emerald-400",
  DEBOARDING: "text-[#ff5c00]",
  DENIED: "text-red-500",
  GPS: "text-[#111111]/45 dark:text-[#f4f4f4]/45",
};

export function LiveFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [buses, setBuses] = useState([
    { id: "UNI1A01", onboard: 31, capacity: 42 },
    { id: "FRT7C11", onboard: 44, capacity: 46 },
    { id: "Linha 214", onboard: 63, capacity: 80 },
  ]);

  useEffect(() => {
    let counter = 0;
    let timeout: number;

    const tick = () => {
      counter += 1;
      const event = makeEvent(counter);
      setEvents((list) => [event, ...list].slice(0, 7));
      if (event.type === "BOARDING" || event.type === "DEBOARDING") {
        setBuses((list) =>
          list.map((bus) => {
            if (Math.random() > 0.5) return bus;
            const delta = event.type === "BOARDING" ? 1 : -1;
            return {
              ...bus,
              onboard: Math.min(bus.capacity, Math.max(0, bus.onboard + delta)),
            };
          }),
        );
      }
      timeout = window.setTimeout(tick, 1400 + Math.random() * 2200);
    };

    timeout = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <div className="hidden lg:block">
      <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
        Painel · agora
      </p>
      <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] xl:text-5xl">
        A operação não para.
        <br />
        <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
          Entre e acompanhe.
        </span>
      </h1>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        {buses.map((bus) => (
          <div
            key={bus.id}
            className="rounded-2xl border border-black/10 p-4 dark:border-white/10"
          >
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#111111]/50 dark:text-[#f4f4f4]/50">
              {bus.id}
            </p>
            <p className="mt-2 font-mono text-2xl tabular-nums">
              <motion.span
                key={bus.onboard}
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="inline-block"
              >
                {bus.onboard}
              </motion.span>
              <span className="text-sm text-[#111111]/40 dark:text-[#f4f4f4]/40">
                /{bus.capacity}
              </span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <motion.div
                animate={{ width: `${(bus.onboard / bus.capacity) * 100}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                className="h-full bg-[#ff5c00]"
              />
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-6 h-[17.5rem] divide-y divide-black/10 overflow-hidden border-y border-black/10 font-mono text-[12px] dark:divide-white/10 dark:border-white/10">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <motion.li
              key={event.id}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="grid grid-cols-[4.5rem_6.5rem_1fr_auto] gap-3 py-2.5"
            >
              <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
                {event.time}
              </span>
              <span className={typeColor[event.type]}>{event.type}</span>
              <span className="truncate">{event.who}</span>
              <span className="text-[#111111]/50 dark:text-[#f4f4f4]/50">
                {event.where}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#111111]/40 dark:text-[#f4f4f4]/40">
        dados de simulação
      </p>
    </div>
  );
}
