"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildApiUrl } from "@/services/api";

export type ListParams = Record<
  string,
  string | number | boolean | undefined | null
>;

type ListResponse<T> = {
  data: T[];
  total?: number;
  page?: number;
  lastPage?: number;
};

function toQueryString(params: ListParams) {
  const search = new URLSearchParams();

  // Ordena as chaves para que a mesma consulta gere sempre a mesma string —
  // é ela que serve de dependência do efeito.
  for (const key of Object.keys(params).sort()) {
    const value = params[key];

    if (value === undefined || value === null || value === "") continue;

    search.set(key, String(value));
  }

  return search.toString();
}

/**
 * Busca uma lista paginada da API.
 *
 * Diferenças em relação ao padrão antigo de cada página:
 * - `loading` é só o primeiro carregamento; recargas usam `isFetching`, então a
 *   tela nunca é desmontada (o input de busca não perde o foco ao digitar);
 * - cada nova consulta aborta a anterior (`AbortController`);
 * - respostas fora de ordem são descartadas.
 */
export function useListQuery<T>(
  path: string,
  params: ListParams,
  options: {
    enabled?: boolean;
    /**
     * Chamado quando a página pedida não existe mais (ex.: o último item da
     * página 3 foi desativado). Sem isso a tabela ficaria vazia e o usuário
     * preso numa página inexistente.
     */
    onPageOutOfRange?: (lastPage: number) => void;
  } = {},
) {
  const { enabled = true, onPageOutOfRange } = options;

  const [rows, setRows] = useState<T[]>([]);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryString = toQueryString(params);
  const requestIdRef = useRef(0);
  const loadedRef = useRef(false);

  // Guardado em ref para não entrar nas dependências do efeito de busca.
  const onPageOutOfRangeRef = useRef(onPageOutOfRange);
  onPageOutOfRangeRef.current = onPageOutOfRange;

  const run = useCallback(
    async (signal?: AbortSignal) => {
      const requestId = ++requestIdRef.current;
      setIsFetching(true);

      try {
        const url = queryString
          ? `${buildApiUrl(path)}?${queryString}`
          : buildApiUrl(path);

        const response = await fetch(url, {
          credentials: "include",
          cache: "no-store",
          signal,
        });

        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? "Seu perfil não tem acesso a estes dados."
              : "Não foi possível carregar a lista agora.",
          );
        }

        const json = (await response.json()) as ListResponse<T>;

        if (requestId !== requestIdRef.current) return;

        const nextRows = Array.isArray(json.data) ? json.data : [];
        const nextLastPage = json.lastPage ?? 1;
        const requestedPage = Number(params.page ?? 1);

        setRows(nextRows);
        setLastPage(nextLastPage);
        setTotal(json.total ?? nextRows.length);
        setError(null);

        if (
          nextRows.length === 0 &&
          nextLastPage >= 1 &&
          requestedPage > nextLastPage
        ) {
          onPageOutOfRangeRef.current?.(nextLastPage);
        }
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === "AbortError") return;
        if (requestId !== requestIdRef.current) return;

        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar a lista agora.",
        );
      } finally {
        if (requestId === requestIdRef.current) {
          loadedRef.current = true;
          setLoading(false);
          setIsFetching(false);
        }
      }
    },
    [path, queryString, params.page],
  );

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();

    void run(controller.signal);

    return () => controller.abort();
  }, [enabled, run]);

  const refetch = useCallback(() => run(), [run]);

  return {
    rows,
    lastPage,
    total,
    /** Só o primeiro carregamento — use para o skeleton da página. */
    loading: loading && !loadedRef.current,
    /** Recargas (busca, filtro, página) — use para um indicador discreto. */
    isFetching,
    error,
    refetch,
    setRows,
  };
}
