"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";
import { ArrowRight } from "lucide-react";
import { segments, type SegmentId } from "./segments";

type Bus = {
  id: string;
  segment: SegmentId;
  line: string;
  vehicle: string;
  path: string;
  duration: number;
  begin: number;
  capacity: number;
  onboard: number;
  nextStop: string;
  lastTag: string;
};

const buses: Bus[] = [
  {
    id: "esc-1",
    segment: "escolar",
    line: "Rota Jardim → Colégio",
    vehicle: "UNI1A01",
    path: "M 60 620 L 60 470 Q 60 440 90 440 L 380 440 Q 410 440 410 410 L 410 260 Q 410 230 440 230 L 1080 230",
    duration: 26,
    begin: 0,
    capacity: 42,
    onboard: 31,
    nextStop: "Rua das Acácias, 120",
    lastTag: "Ana Souza · 06:52",
  },
  {
    id: "esc-2",
    segment: "escolar",
    line: "Rota Centro → Colégio",
    vehicle: "UNI2B02",
    path: "M 1140 640 L 1140 520 Q 1140 490 1110 490 L 760 490 Q 730 490 730 460 L 730 330 Q 730 300 700 300 L 470 300",
    duration: 22,
    begin: -9,
    capacity: 28,
    onboard: 12,
    nextStop: "Praça da Matriz",
    lastTag: "Bruno Oliveira · 06:58",
  },
  {
    id: "fre-1",
    segment: "fretamento",
    line: "Fretamento · Fábrica Norte",
    vehicle: "FRT7C11",
    path: "M 220 80 L 220 200 Q 220 230 250 230 L 560 230 Q 590 230 590 260 L 590 560 Q 590 590 620 590 L 960 590",
    duration: 30,
    begin: -5,
    capacity: 46,
    onboard: 44,
    nextStop: "Portaria 2",
    lastTag: "Carla Mendes · 05:41",
  },
  {
    id: "pub-1",
    segment: "publico",
    line: "Linha 214 · Terminal ↔ Hospital",
    vehicle: "5521-8",
    path: "M 20 350 L 1180 350",
    duration: 24,
    begin: -3,
    capacity: 80,
    onboard: 63,
    nextStop: "Av. Brasil, 1400",
    lastTag: "Cartão ***3921 · agora",
  },
  {
    id: "pub-2",
    segment: "publico",
    line: "Linha 07 · Circular",
    vehicle: "5490-2",
    path: "M 900 90 L 900 640 L 1060 640 L 1060 90 Z",
    duration: 28,
    begin: -14,
    capacity: 80,
    onboard: 27,
    nextStop: "Terminal Leste",
    lastTag: "Cartão ***0871 · há 40s",
  },
];

const stops: Array<[number, number]> = [
  [60, 470],
  [410, 260],
  [730, 330],
  [590, 560],
  [420, 350],
  [800, 350],
  [1060, 350],
  [900, 640],
  [220, 200],
];

function useTicker(start: number, every: [number, number], step: [number, number]) {
  const value = useMotionValue(start);
  const rounded = useTransform(value, (latest) =>
    Math.round(latest).toLocaleString("pt-BR"),
  );
  const config = useRef({ every, step });

  useEffect(() => {
    let cancelled = false;
    let timeout: number;
    const { every, step } = config.current;

    const tick = () => {
      if (cancelled) return;
      const delta = step[0] + Math.random() * (step[1] - step[0]);
      animate(value, value.get() + delta, { duration: 0.9, ease: "easeOut" });
      timeout = window.setTimeout(
        tick,
        every[0] + Math.random() * (every[1] - every[0]),
      );
    };

    timeout = window.setTimeout(tick, every[0]);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [value]);

  return rounded;
}

export function CityHero() {
  const [segment, setSegment] = useState<SegmentId>("escolar");
  const [hovered, setHovered] = useState<{
    bus: Bus;
    x: number;
    y: number;
  } | null>(null);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const busRefs = useRef<Record<string, SVGGElement | null>>({});

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const parallaxX = useSpring(useTransform(mouseX, [-1, 1], [18, -18]), {
    stiffness: 60,
    damping: 20,
  });
  const parallaxY = useSpring(useTransform(mouseY, [-1, 1], [12, -12]), {
    stiffness: 60,
    damping: 20,
  });

  const boardings = useTicker(1284, [1800, 4200], [1, 3]);
  const readsPerMinute = useTicker(38, [2500, 5000], [-2, 3]);

  const active = useMemo(
    () => segments.find((item) => item.id === segment)!,
    [segment],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = sectionRef.current?.getBoundingClientRect();
      if (!rect) return;
      mouseX.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
      mouseY.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
    },
    [mouseX, mouseY],
  );

  const showCard = useCallback((bus: Bus) => {
    const node = busRefs.current[bus.id];
    const rect = node?.getBoundingClientRect();
    const host = sectionRef.current?.getBoundingClientRect();
    if (!rect || !host) return;
    svgRef.current?.pauseAnimations();
    setHovered({
      bus,
      x: rect.left + rect.width / 2 - host.left,
      y: rect.top - host.top,
    });
  }, []);

  const hideCard = useCallback(() => {
    svgRef.current?.unpauseAnimations();
    setHovered(null);
  }, []);

  return (
    <section
      ref={sectionRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        mouseX.set(0);
        mouseY.set(0);
        hideCard();
      }}
      className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden"
    >
      <motion.div
        style={{ x: parallaxX, y: parallaxY }}
        className="absolute inset-[-3%]"
        aria-hidden="true"
      >
        <svg
          ref={svgRef}
          viewBox="0 0 1200 700"
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full text-[#111111] dark:text-[#f4f4f4]"
        >
          <defs>
            <pattern
              id="city-grid"
              width="90"
              height="70"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 90 0 L 0 0 0 70"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.07"
                strokeWidth="1"
              />
            </pattern>
            <radialGradient id="city-fade" cx="50%" cy="45%" r="70%">
              <stop offset="55%" stopColor="white" stopOpacity="1" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
            <mask id="city-mask">
              <rect width="1200" height="700" fill="url(#city-fade)" />
            </mask>
          </defs>

          <g mask="url(#city-mask)">
            <rect width="1200" height="700" fill="url(#city-grid)" />
            <path
              d="M -20 120 C 200 90, 300 200, 520 160 S 900 60, 1220 130"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.04"
              strokeWidth="26"
              strokeLinecap="round"
            />

            {buses.map((bus) => {
              const isActive = bus.segment === segment;
              return (
                <path
                  key={`route-${bus.id}`}
                  d={bus.path}
                  fill="none"
                  stroke={isActive ? "#ff5c00" : "currentColor"}
                  strokeOpacity={isActive ? 0.55 : 0.12}
                  strokeWidth={isActive ? 2 : 1.5}
                  strokeDasharray={isActive ? "1 9" : undefined}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              );
            })}

            {stops.map(([x, y]) => (
              <circle
                key={`${x}-${y}`}
                cx={x}
                cy={y}
                r="3.5"
                fill="currentColor"
                fillOpacity="0.5"
              />
            ))}

            {buses.map((bus) => {
              const isActive = bus.segment === segment;
              return (
                <g
                  key={bus.id}
                  ref={(node) => {
                    busRefs.current[bus.id] = node;
                  }}
                  className="cursor-pointer transition-opacity duration-700"
                  style={{
                    opacity: isActive ? 1 : 0.25,
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                  onPointerEnter={() => showCard(bus)}
                  onPointerLeave={hideCard}
                >
                  <circle r="30" fill="transparent" />
                  <circle
                    r="16"
                    fill="#ff5c00"
                    fillOpacity="0.18"
                    className="unipass-bus-halo"
                  />
                  <circle r="7" fill="#ff5c00" />
                  <circle r="2.5" fill="white" />
                  <animateMotion
                    dur={`${bus.duration}s`}
                    begin={`${bus.begin}s`}
                    repeatCount="indefinite"
                    path={bus.path}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </motion.div>

      <AnimatePresence>
        {hovered && (
          <motion.div
            key={hovered.bus.id}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            style={{ left: hovered.x, top: hovered.y }}
            className="pointer-events-none absolute z-20 w-64 -translate-x-1/2 -translate-y-[calc(100%+18px)] rounded-2xl border border-black/10 bg-white/95 p-4 text-left shadow-[0_20px_50px_rgba(0,0,0,0.12)] backdrop-blur dark:border-white/10 dark:bg-[#141416]/95"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#ff5c00]">
                {hovered.bus.vehicle}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#111111]/60 dark:text-[#f4f4f4]/60">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                ao vivo
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug">
              {hovered.bus.line}
            </p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-[#111111]/50 dark:text-[#f4f4f4]/50">
                  a bordo
                </p>
                <p className="font-mono text-2xl tabular-nums leading-none">
                  {hovered.bus.onboard}
                  <span className="text-sm text-[#111111]/40 dark:text-[#f4f4f4]/40">
                    /{hovered.bus.capacity}
                  </span>
                </p>
              </div>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(hovered.bus.onboard / hovered.bus.capacity) * 100}%`,
                  }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="h-full rounded-full bg-[#ff5c00]"
                />
              </div>
            </div>
            <dl className="mt-3 space-y-1 border-t border-black/10 pt-3 text-xs dark:border-white/10">
              <div className="flex justify-between gap-3">
                <dt className="text-[#111111]/50 dark:text-[#f4f4f4]/50">
                  próxima parada
                </dt>
                <dd className="text-right">{hovered.bus.nextStop}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#111111]/50 dark:text-[#f4f4f4]/50">
                  última leitura
                </dt>
                <dd className="text-right">{hovered.bus.lastTag}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none relative mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-6xl flex-col justify-between px-6 pb-10 pt-12 sm:px-8 lg:pt-20">
        <div className="max-w-2xl">
          <div
            role="tablist"
            aria-label="Segmento"
            className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full [scrollbar-width:none] sm:inline-flex border border-black/10 bg-white/70 p-1 backdrop-blur dark:border-white/10 dark:bg-[#141416]/70"
          >
            {segments.map((item) => {
              const selected = item.id === segment;
              return (
                <button
                  key={item.id}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setSegment(item.id);
                    setHovered(null);
                  }}
                  className="relative shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
                >
                  {selected && (
                    <motion.span
                      layoutId="segment-pill"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#111111] dark:bg-[#f4f4f4]"
                    />
                  )}
                  <span
                    className={
                      selected
                        ? "relative text-white dark:text-[#0b0b0c]"
                        : "relative text-[#111111]/70 dark:text-[#f4f4f4]/70"
                    }
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={active.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="mt-10"
            >
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-[#ff5c00]">
                {active.eyebrow}
              </p>
              <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
                {active.title[0]}
                <br />
                <span className="text-[#111111]/40 dark:text-[#f4f4f4]/40">
                  {active.title[1]}
                </span>
              </h1>
              <p className="mt-7 max-w-lg text-lg leading-8 text-[#111111]/65 dark:text-[#f4f4f4]/65">
                {active.description}
              </p>
            </motion.div>
          </AnimatePresence>

          <div className="pointer-events-auto mt-10 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/cadastro/empresa"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff5c00] px-6 text-sm font-semibold text-white transition hover:bg-[#e65300]"
            >
              Começar agora
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-full border border-black/15 bg-white/60 px-6 text-sm font-semibold backdrop-blur transition hover:border-black/40 dark:border-white/20 dark:bg-[#141416]/60 dark:hover:border-white/50"
            >
              Já tenho conta
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-6 border-t border-black/10 pt-6 sm:grid-cols-3 dark:border-white/10">
          <Stat label="embarques hoje" value={boardings} />
          <Stat label="leituras por minuto" value={readsPerMinute} />
          <div className="sm:text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#111111]/45 dark:text-[#f4f4f4]/45">
              passe o mouse nos veículos
            </p>
            <p className="mt-2 text-sm text-[#111111]/60 dark:text-[#f4f4f4]/60">
              Dados de simulação. A operação real vive no painel.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReturnType<typeof useTransform<number, string>>;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#111111]/45 dark:text-[#f4f4f4]/45">
        {label}
      </p>
      <motion.p className="mt-2 font-mono text-4xl tabular-nums tracking-tight">
        {value}
      </motion.p>
    </div>
  );
}
