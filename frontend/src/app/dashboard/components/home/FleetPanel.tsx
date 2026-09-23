"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Bus, SmartphoneNfc } from "lucide-react";
import { EmptyState, Panel, PanelHeader } from "../primitives";
import type { DashboardMetrics } from "../../types/dashboard";

function formatRelative(iso: string | null) {
  if (!iso) return "nunca reportou";

  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );

  if (seconds < 60) return `há ${seconds}s`;
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)}h`;

  return `há ${Math.floor(seconds / 86400)}d`;
}

export function FleetPanel({ fleet }: { fleet: DashboardMetrics["fleet"] }) {
  const { liveDevices, devicesOnline, buses, busesWithoutDevice } = fleet;

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Frota"
        hint={`${devicesOnline} de ${liveDevices.length} UniHubs online · ${buses} ônibus`}
        action={
          <Link
            href="/dashboard/location"
            className="text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
          >
            Mapa
          </Link>
        }
      />

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto unipass-scrollbar px-5 pb-5">
        {liveDevices.length === 0 ? (
          <EmptyState
            icon={<SmartphoneNfc size={20} />}
            title="Nenhum UniHub vinculado a um ônibus"
            description="Pareie um dispositivo para acompanhar embarques e localização."
          />
        ) : (
          <ul className="space-y-1.5">
            {liveDevices.map((device, index) => (
              <motion.li
                key={device.deviceId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
              >
                <Link
                  href="/dashboard/location"
                  className="flex items-center gap-3 rounded-2xl border border-border/50 px-3 py-2 transition hover:border-foreground/20 hover:bg-accent/40"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: device.online ? "#22c55e" : "#a1a1aa",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {device.busPlate ?? "Sem placa"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {device.name ?? device.code ?? "UniHub"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {formatRelative(device.lastUpdate)}
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        )}

        {busesWithoutDevice > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Bus size={12} />
            {busesWithoutDevice}{" "}
            {busesWithoutDevice === 1
              ? "ônibus ainda sem UniHub"
              : "ônibus ainda sem UniHub"}
          </p>
        )}
      </div>
    </Panel>
  );
}
