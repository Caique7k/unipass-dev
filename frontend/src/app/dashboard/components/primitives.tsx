"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { cn } from "@/lib/utils";

export const ACCENT = "#ff5c00";

export const spring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 30,
};

/** Entrada em cascata: o pai orquestra, cada filho usa `riseItem`. */
export const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const riseItem = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: spring },
};

/**
 * Superfície base do painel. O gradiente de topo e a borda clara são o que
 * diferenciam o card do fundo sem precisar de sombra pesada.
 */
export function Panel({
  className,
  children,
  interactive = false,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  interactive?: boolean;
} & React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div
      variants={riseItem}
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60",
        "bg-card/70 backdrop-blur-xl",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/15 before:to-transparent",
        interactive &&
          "transition-colors hover:border-[color:var(--accent-border)] cursor-pointer",
        className,
      )}
      style={
        interactive
          ? ({ "--accent-border": `${ACCENT}55` } as React.CSSProperties)
          : undefined
      }
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  );
}

/** Contador que anima do valor anterior até o novo a cada atualização. */
export function AnimatedNumber({
  value,
  className,
  format = (n: number) => Math.round(n).toLocaleString("pt-BR"),
}: {
  value: number;
  className?: string;
  format?: (value: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduceMotion) {
      node.textContent = format(value);
      previous.current = value;
      return;
    }

    const controls = animate(previous.current, value, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });

    previous.current = value;

    return () => controls.stop();
  }, [value, format, reduceMotion]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(value)}
    </span>
  );
}

/** Ponto pulsante de "ao vivo". Fica estático quando a atualização está pausada. */
export function LiveDot({ active = true }: { active?: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {active && (
        <motion.span
          className="absolute inline-flex h-full w-full rounded-full"
          style={{ backgroundColor: "#22c55e" }}
          animate={{ opacity: [0.6, 0, 0.6], scale: [1, 2.2, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? "#22c55e" : "#a1a1aa" }}
      />
    </span>
  );
}

export function TrendPill({
  delta,
  suffix = "vs ontem",
}: {
  delta: number;
  suffix?: string;
}) {
  const tone =
    delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  const sign = delta > 0 ? "+" : "";

  return (
    <span className={cn("text-xs font-medium tabular-nums", tone)}>
      {delta === 0 ? "estável" : `${sign}${delta}`}{" "}
      <span className="font-normal text-muted-foreground">{suffix}</span>
    </span>
  );
}

/** Sparkline em SVG puro — leve o bastante para repetir em cada KPI. */
export function Sparkline({
  values,
  color = ACCENT,
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [id] = useState(() => `spark-${Math.random().toString(36).slice(2)}`);

  if (values.length < 2) {
    return <div className={cn("h-8", className)} />;
  }

  const width = 100;
  const height = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x},${y}`)
    .join(" ");

  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={reduceMotion ? undefined : { pathLength: 0 }}
        animate={reduceMotion ? undefined : { pathLength: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

/** Anel de progresso usado na ocupação da frota. */
export function ProgressRing({
  value,
  size = 112,
  stroke = 9,
  label,
  caption,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label: string;
  caption?: string;
}) {
  const reduceMotion = useReducedMotion();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(value, 100));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}${caption ? ` — ${caption}` : ""}`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border/70"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={ACCENT}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduceMotion ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums">{label}</span>
        {caption && (
          <span className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-[34ch] text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
