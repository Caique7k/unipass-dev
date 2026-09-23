"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "motion/react";
import { ACCENT, EmptyState, Panel, PanelHeader } from "../primitives";
import type { SeriesPoint } from "../../types/dashboard";
import { cn } from "@/lib/utils";

type SeriesKey = "boardings" | "deboardings" | "denied";

const SERIES: Array<{ key: SeriesKey; label: string; color: string }> = [
  { key: "boardings", label: "Embarques", color: ACCENT },
  { key: "deboardings", label: "Desembarques", color: "#0ea5e9" },
  { key: "denied", label: "Negados", color: "#ef4444" },
];

function formatDayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(year, month - 1, day));
}

function formatFullDay(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(year, month - 1, day));
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  return (
    <div className="rounded-2xl border border-border/60 bg-popover/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {formatFullDay(label)}
      </p>
      <div className="mt-1.5 space-y-1">
        {payload.map((entry) => {
          const series = SERIES.find((item) => item.key === entry.dataKey);

          return (
            <div
              key={entry.dataKey}
              className="flex items-center gap-2 text-xs"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{series?.label}</span>
              <span className="ml-auto font-semibold tabular-nums">
                {entry.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FlowChart({ series }: { series: SeriesPoint[] }) {
  const [hidden, setHidden] = useState<SeriesKey[]>([]);

  const hasData = useMemo(
    () =>
      series.some(
        (point) => point.boardings + point.deboardings + point.denied > 0,
      ),
    [series],
  );

  const visible = SERIES.filter((item) => !hidden.includes(item.key));

  function toggle(key: SeriesKey) {
    setHidden((prev) => {
      // Nunca deixa o gráfico sem nenhuma série visível.
      if (prev.includes(key)) return prev.filter((item) => item !== key);
      if (prev.length === SERIES.length - 1) return prev;
      return [...prev, key];
    });
  }

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Fluxo de embarque"
        hint="Últimos 7 dias"
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            {SERIES.map((item) => {
              const isHidden = hidden.includes(item.key);

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggle(item.key)}
                  aria-pressed={!isHidden}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition cursor-pointer",
                    isHidden
                      ? "border-border/50 text-muted-foreground/70 opacity-60"
                      : "border-border/70 text-foreground hover:border-foreground/25",
                  )}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full transition"
                    style={{
                      backgroundColor: isHidden ? "currentColor" : item.color,
                    }}
                  />
                  {item.label}
                </button>
              );
            })}
          </div>
        }
      />

      <div className="mt-4 min-h-0 flex-1 px-1 pb-4">
        {hasData ? (
          <motion.div
            className="h-full min-h-[220px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={series}
                margin={{ top: 8, right: 16, left: -18, bottom: 0 }}
              >
                <defs>
                  {SERIES.map((item) => (
                    <linearGradient
                      key={item.key}
                      id={`flow-${item.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={item.color}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor={item.color}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  ))}
                </defs>

                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 6"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayLabel}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  dy={6}
                />
                <YAxis
                  allowDecimals={false}
                  width={44}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                />

                {visible.map((item) => (
                  <Area
                    key={item.key}
                    type="monotone"
                    dataKey={item.key}
                    stroke={item.color}
                    strokeWidth={2}
                    fill={`url(#flow-${item.key})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                    animationDuration={700}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </motion.div>
        ) : (
          <EmptyState
            title="Nenhuma leitura de TAG nos últimos 7 dias"
            description="Assim que um UniHub registrar embarques, o fluxo aparece aqui."
          />
        )}
      </div>
    </Panel>
  );
}
