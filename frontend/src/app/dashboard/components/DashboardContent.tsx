"use client";

import { motion } from "motion/react";
import { RefreshCw } from "lucide-react";
import { HeroToday } from "./home/HeroToday";
import { KpiRow } from "./home/KpiRow";
import { FlowChart } from "./home/FlowChart";
import { UpcomingSchedules } from "./home/UpcomingSchedules";
import { EventFeed } from "./home/EventFeed";
import { FleetPanel } from "./home/FleetPanel";
import {
  AlertsPanel,
  BillingPanel,
  ConfirmationsPanel,
} from "./home/SidePanels";
import { staggerParent } from "./primitives";
import { DashboardContentSkeleton } from "./DashboardSkeletons";
import type { DashboardMetrics } from "../types/dashboard";

type DashboardContentProps = {
  data: DashboardMetrics | null;
  loading: boolean;
  error: string | null;
  live: boolean;
  onRetry: () => void;
};

export function DashboardContent({
  data,
  loading,
  error,
  live,
  onRetry,
}: DashboardContentProps) {
  if (loading && !data) return <DashboardContentSkeleton />;

  if (error && !data) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-border/70 text-center">
        <p className="text-sm font-medium">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border/70 px-4 py-2 text-xs transition hover:bg-accent"
        >
          <RefreshCw size={13} />
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="space-y-4"
    >
      <HeroToday data={data} />

      <KpiRow data={data} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FlowChart series={data.series} />
        </div>
        <div className="min-h-[320px]">
          <UpcomingSchedules schedules={data.schedules} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-h-[360px]">
          <EventFeed events={data.recentEvents} live={live} />
        </div>
        <div className="min-h-[360px]">
          <FleetPanel fleet={data.fleet} />
        </div>
        <div className="flex min-h-[360px] flex-col gap-4">
          <AlertsPanel alerts={data.alerts} />
          {data.billing && <BillingPanel billing={data.billing} />}
        </div>
      </div>

      <ConfirmationsPanel confirmations={data.confirmations} />
    </motion.div>
  );
}
