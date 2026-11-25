"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "@/services/api";
import type { MyTrip } from "../types/my-trip";

// Curto de propósito, para a demonstração do TCC (CLAUDE.md, seção 12).
const REFRESH_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 8000;

export function useMyTrip(enabled: boolean) {
  const [trip, setTrip] = useState<MyTrip | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Uma consulta por vez. Numa rede mais lenta que o intervalo, descartar a
  // resposta anterior (como o useDashboard faz) nunca atualizaria a tela.
  const currentRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    currentRef.current?.abort();
    currentRef.current = controller;

    try {
      const res = await fetch(buildApiUrl("/transport/me/today"), {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as MyTrip;

      if (currentRef.current !== controller) return;

      setTrip(json);
      setError(null);
    } catch {
      if (currentRef.current !== controller) return;

      setError("Não foi possível carregar sua viagem agora.");
    } finally {
      clearTimeout(timeoutId);

      if (currentRef.current === controller) {
        currentRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Não gasta requisição com a aba em segundo plano.
    const isVisible = () => document.visibilityState === "visible";

    const onTick = () => {
      if (isVisible() && !currentRef.current) void load();
    };

    // Ao voltar para a aba (ou desbloquear o celular), atualiza na hora, no
    // lugar de uma consulta que possa ter ficado congelada.
    const onVisibilityChange = () => {
      if (isVisible()) void load();
    };

    onTick();
    const intervalId = setInterval(onTick, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      currentRef.current?.abort();
      currentRef.current = null;
    };
  }, [enabled, load]);

  return {
    trip,
    /** Só o primeiro carregamento: as recargas trocam os dados sem piscar. */
    loading: !trip && !error,
    error,
    refresh: load,
  };
}
