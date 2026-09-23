"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { buildApiUrl } from "@/services/api";
import type { BillingTemplateRecurrence } from "../../billing-groups/types/billing-group";

export type GroupOption = {
  id: string;
  name: string;
  active: boolean;
};

export type RouteOption = {
  id: string;
  name: string;
  active: boolean;
};

export type BillingTemplateOption = {
  id: string;
  name: string;
  active: boolean;
  amountCents: number;
  dueDay: number;
  recurrence: BillingTemplateRecurrence;
};

const OPTIONS_LIMIT = 1000;

async function loadOptions<T>(
  path: string,
  signal: AbortSignal,
): Promise<T[]> {
  const params = new URLSearchParams({
    page: "1",
    limit: String(OPTIONS_LIMIT),
    active: "true",
  });

  const response = await fetch(`${buildApiUrl(path)}?${params.toString()}`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) throw new Error();

  const json = (await response.json()) as { data: T[] };

  return json.data ?? [];
}

/**
 * Carrega as opções usadas pelo formulário de aluno (grupos, rotas e grupos de
 * boletos).
 *
 * Antes, abrir o modal disparava as três listas de novo a cada vez. Agora elas
 * são buscadas na primeira abertura e reaproveitadas enquanto a tela estiver
 * montada — são cadastros que não mudam por esta página.
 */
export function useStudentFormOptions(enabled: boolean) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [billingTemplates, setBillingTemplates] = useState<
    BillingTemplateOption[]
  >([]);

  const [loaded, setLoaded] = useState(false);

  const startedRef = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    const [groupsResult, routesResult, templatesResult] =
      await Promise.allSettled([
        loadOptions<GroupOption>("/groups", signal),
        loadOptions<RouteOption>("/routes", signal),
        loadOptions<BillingTemplateOption>("/billing/templates", signal),
      ]);

    if (signal.aborted) return;

    if (groupsResult.status === "fulfilled") {
      setGroups(groupsResult.value);
    } else {
      toast.error("Erro ao buscar grupos cadastrados.");
    }

    if (routesResult.status === "fulfilled") {
      setRoutes(routesResult.value);
    } else {
      toast.error("Erro ao buscar rotas cadastradas.");
    }

    if (templatesResult.status === "fulfilled") {
      setBillingTemplates(templatesResult.value);
    } else {
      toast.error("Erro ao buscar grupos de boletos cadastrados.");
    }

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!enabled || startedRef.current) return;

    startedRef.current = true;

    const controller = new AbortController();

    // A carga roda fora do corpo síncrono do efeito: nenhum setState acontece
    // antes do primeiro await.
    void Promise.resolve().then(() => load(controller.signal));

    return () => controller.abort();
  }, [enabled, load]);

  return {
    groups,
    routes,
    billingTemplates,
    // Derivado em vez de estado próprio: evita um setState logo na entrada do
    // efeito, que dispara renderizações em cascata.
    loading: enabled && !loaded,
    loaded,
  };
}
