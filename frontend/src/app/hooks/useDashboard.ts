"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "@/services/api";
import type { DashboardMetrics } from "../dashboard/types/dashboard";

const REFRESH_INTERVAL_MS = 15000;

export function useDashboard() {
  const [data, setData] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [live, setLive] = useState(true);

  // Evita que uma resposta lenta sobrescreva uma mais recente.
  const requestIdRef = useRef(0);

  const fetchDashboard = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);

    try {
      const res = await fetch(buildApiUrl("/dashboard"), {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "Seu perfil não tem acesso às métricas da empresa."
            : "Não foi possível carregar o painel agora.",
        );
      }

      const json = (await res.json()) as DashboardMetrics;

      if (requestId !== requestIdRef.current) return;

      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível carregar o painel agora.",
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!live) return;

    const interval = setInterval(() => {
      // Não gasta requisição com a aba em segundo plano.
      if (document.visibilityState === "visible") {
        void fetchDashboard();
      }
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [live, fetchDashboard]);

  return {
    data,
    loading,
    refreshing,
    error,
    lastUpdated,
    live,
    toggleLive: () => setLive((prev) => !prev),
    refresh: fetchDashboard,
  };
}
