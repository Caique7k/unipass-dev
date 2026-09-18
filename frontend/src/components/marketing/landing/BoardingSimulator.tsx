"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Nfc } from "lucide-react";

type Tag = {
  id: string;
  name: string;
  detail: string;
  registered: boolean;
};

type ScreenState = {
  tone: "idle" | "ok" | "warn" | "deny";
  title: string;
  subtitle: string;
};

type LogEvent = {
  id: number;
  time: string;
  type: "BOARDING" | "DEBOARDING" | "DENIED";
  who: string;
};

const tags: Tag[] = [
  { id: "ana", name: "Ana Souza", detail: "Matrícula 20260001", registered: true },
  { id: "bruno", name: "Bruno Oliveira", detail: "Matrícula 20260002", registered: true },
  { id: "unknown", name: "TAG sem cadastro", detail: "04C3D4E5F6", registered: false },
];

const BASE_ONBOARD = 23;
const CAPACITY = 42;
const READ_DISTANCE = 70;

const idleScreen: ScreenState = {
  tone: "idle",
  title: "Aproxime a TAG",
  subtitle: "Arraste um cartão até o leitor",
};

function now() {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

export function BoardingSimulator() {
  const readerRef = useRef<HTMLDivElement | null>(null);
  const tagRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const armedRef = useRef(true);
  const draggingRef = useRef<string | null>(null);
  const [mode, setMode] = useState<"boarding" | "deboarding">("boarding");
  const [aboard, setAboard] = useState<Set<string>>(() => new Set());
  const [screen, setScreen] = useState<ScreenState>(idleScreen);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [pulse, setPulse] = useState(0);

  const scan = useCallback(
    (tag: Tag) => {
      setPulse((value) => value + 1);
      const time = now();
      const push = (type: LogEvent["type"], who: string) =>
        setEvents((list) =>
          [{ id: Date.now(), time, type, who }, ...list].slice(0, 6),
        );

      if (!tag.registered) {
        setScreen({
          tone: "deny",
          title: "TAG não autorizada",
          subtitle: "Nenhum cadastro para esta TAG",
        });
        push("DENIED", tag.detail);
        return;
      }

      if (mode === "boarding") {
        if (aboard.has(tag.id)) {
          setScreen({
            tone: "warn",
            title: "Já está a bordo",
            subtitle: `${tag.name} embarcou nesta viagem`,
          });
          return;
        }
        setAboard((set) => new Set(set).add(tag.id));
        setScreen({
          tone: "ok",
          title: `${tag.name}`,
          subtitle: "Embarque registrado",
        });
        push("BOARDING", tag.name);
        return;
      }

      if (!aboard.has(tag.id)) {
        setScreen({
          tone: "warn",
          title: "Não está no ônibus",
          subtitle: `${tag.name} não embarcou nesta viagem`,
        });
        return;
      }
      setAboard((set) => {
        const next = new Set(set);
        next.delete(tag.id);
        return next;
      });
      setScreen({
        tone: "ok",
        title: `${tag.name}`,
        subtitle: "Desembarque registrado",
      });
      push("DEBOARDING", tag.name);
    },
    [aboard, mode],
  );

  const handleDrag = useCallback(
    (tag: Tag) => {
      if (!armedRef.current || draggingRef.current !== tag.id) return;
      const reader = readerRef.current?.getBoundingClientRect();
      const card = tagRefs.current[tag.id]?.getBoundingClientRect();
      if (!reader || !card) return;

      const dx = card.left + card.width / 2 - (reader.left + reader.width / 2);
      const dy = card.top + card.height / 2 - (reader.top + reader.height / 2);

      if (Math.hypot(dx, dy) < READ_DISTANCE) {
        armedRef.current = false;
        scan(tag);
      }
    },
    [scan],
  );

  const onboard = BASE_ONBOARD + aboard.size;

  return (
    <section className="border-t border-black/10 py-24 dark:border-white/10">
      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
              Experimente
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Arraste uma TAG
              <br />
              até o UniHub.
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-[#111111]/65 dark:text-[#f4f4f4]/65">
              É exatamente isso que acontece no ônibus: o leitor identifica a
              TAG, o backend decide se pode embarcar e o painel atualiza a
              lotação no mesmo segundo.
            </p>

            <div className="mt-8 inline-flex rounded-full border border-black/10 p-1 dark:border-white/10">
              {(["boarding", "deboarding"] as const).map((item) => {
                const selected = mode === item;
                return (
                  <button
                    key={item}
                    onClick={() => {
                      setMode(item);
                      setScreen(idleScreen);
                    }}
                    className="relative cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium"
                  >
                    {selected && (
                      <motion.span
                        layoutId="mode-pill"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        className="absolute inset-0 rounded-full bg-[#ff5c00]"
                      />
                    )}
                    <span
                      className={
                        selected
                          ? "relative text-white"
                          : "relative text-[#111111]/60 dark:text-[#f4f4f4]/60"
                      }
                    >
                      {item === "boarding" ? "Modo embarque" : "Modo desembarque"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              {tags.map((tag) => (
                <motion.div
                  key={tag.id}
                  ref={(node) => {
                    tagRefs.current[tag.id] = node;
                  }}
                  drag
                  dragSnapToOrigin
                  dragElastic={0.2}
                  dragMomentum={false}
                  whileDrag={{ scale: 1.06, rotate: -3, zIndex: 30 }}
                  whileHover={{ y: -3 }}
                  onDragStart={() => {
                    draggingRef.current = tag.id;
                    armedRef.current = true;
                  }}
                  onDrag={() => handleDrag(tag)}
                  onDragEnd={() => {
                    draggingRef.current = null;
                    armedRef.current = true;
                  }}
                  className={`relative w-44 cursor-grab select-none rounded-2xl border p-4 shadow-[0_10px_30px_rgba(0,0,0,0.08)] active:cursor-grabbing ${
                    tag.registered
                      ? "border-black/10 bg-white dark:border-white/10 dark:bg-[#17171a]"
                      : "border-dashed border-black/20 bg-white/60 dark:border-white/20 dark:bg-[#17171a]/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#ff5c00]">
                      RFID
                    </span>
                    <Nfc className="size-4 text-[#111111]/40 dark:text-[#f4f4f4]/40" />
                  </div>
                  <p className="mt-5 text-sm font-semibold">{tag.name}</p>
                  <p className="font-mono text-[11px] text-[#111111]/50 dark:text-[#f4f4f4]/50">
                    {tag.detail}
                  </p>
                  {aboard.has(tag.id) && (
                    <span className="absolute right-3 top-3 size-2 rounded-full bg-emerald-500" />
                  )}
                </motion.div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
            <div className="rounded-[28px] border border-black/10 bg-[#f0f0ee] p-5 dark:border-white/10 dark:bg-[#141416]">
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-[#111111]/50 dark:text-[#f4f4f4]/50">
                <span>UniHub · UNI1A01</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  4G
                </span>
              </div>

              <div
                className={`mt-4 min-h-[112px] rounded-2xl p-4 transition-colors duration-300 ${
                  screen.tone === "ok"
                    ? "bg-emerald-600 text-white"
                    : screen.tone === "warn"
                      ? "bg-amber-500 text-black"
                      : screen.tone === "deny"
                        ? "bg-red-600 text-white"
                        : "bg-[#0b0b0c] text-[#f4f4f4] dark:bg-black"
                }`}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${screen.title}-${pulse}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] opacity-70">
                      {screen.tone === "idle"
                        ? mode === "boarding"
                          ? "embarque"
                          : "desembarque"
                        : screen.tone === "ok"
                          ? "autorizado"
                          : "negado"}
                    </p>
                    <p className="mt-2 text-lg font-semibold leading-tight">
                      {screen.title}
                    </p>
                    <p className="mt-1 text-sm opacity-80">{screen.subtitle}</p>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="mt-4 flex items-center gap-4">
                <div
                  ref={readerRef}
                  className="relative flex size-24 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white dark:border-white/10 dark:bg-[#0b0b0c]"
                >
                  <motion.span
                    key={pulse}
                    initial={{ scale: 0.8, opacity: 0.8 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                    className="absolute inset-0 rounded-full border-2 border-[#ff5c00]"
                  />
                  <span className="absolute inset-0 animate-[unipassRfidPulse_2.8s_ease-out_infinite] rounded-full border border-[#ff5c00]/50" />
                  <Nfc className="size-8 text-[#ff5c00]" />
                </div>
                <div className="text-sm text-[#111111]/60 dark:text-[#f4f4f4]/60">
                  <p className="font-medium text-[#111111] dark:text-[#f4f4f4]">
                    Leitor RFID
                  </p>
                  <p>Solte a TAG sobre o círculo.</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:w-56">
              <div className="rounded-[28px] border border-black/10 p-5 dark:border-white/10">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#111111]/50 dark:text-[#f4f4f4]/50">
                  a bordo agora
                </p>
                <p className="mt-2 font-mono text-4xl tabular-nums tracking-tight">
                  <motion.span
                    key={onboard}
                    initial={{ y: 8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="inline-block"
                  >
                    {onboard}
                  </motion.span>
                  <span className="text-lg text-[#111111]/40 dark:text-[#f4f4f4]/40">
                    /{CAPACITY}
                  </span>
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <motion.div
                    animate={{ width: `${(onboard / CAPACITY) * 100}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                    className="h-full rounded-full bg-[#ff5c00]"
                  />
                </div>
              </div>

              <div className="flex-1 rounded-[28px] border border-black/10 p-5 dark:border-white/10">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#111111]/50 dark:text-[#f4f4f4]/50">
                  eventos
                </p>
                <ul className="mt-3 space-y-2 font-mono text-[11px]">
                  <AnimatePresence initial={false}>
                    {events.length === 0 && (
                      <motion.li
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-[#111111]/40 dark:text-[#f4f4f4]/40"
                      >
                        aguardando leitura…
                      </motion.li>
                    )}
                    {events.map((event) => (
                      <motion.li
                        key={event.id}
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-start gap-2"
                      >
                        <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
                          {event.time}
                        </span>
                        <span
                          className={
                            event.type === "DENIED"
                              ? "text-red-500"
                              : event.type === "BOARDING"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-[#ff5c00]"
                          }
                        >
                          {event.type}
                        </span>
                        <span className="truncate">{event.who}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
