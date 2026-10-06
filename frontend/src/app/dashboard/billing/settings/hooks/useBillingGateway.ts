"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import api from "@/services/api";
import type {
  BillingGatewayMode,
  BillingGatewayView,
  WebhookSetupResult,
} from "../types/billing-gateway";

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;

    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === "string") return message;
    if (!error.response) {
      return "Sem resposta do servidor. Verifique sua conexão e tente de novo.";
    }
  }

  return fallback;
}

export type GatewayAction =
  | "mode"
  | "saveKey"
  | "test"
  | "remove"
  | "webhook";

/**
 * Estado e ações da tela "Gateway de cobrança". A chave de API só vai do
 * formulário para o backend; nada aqui guarda ou recebe a chave de volta.
 */
export function useBillingGateway() {
  const [gateway, setGateway] = useState<BillingGatewayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<GatewayAction | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const response = await api.get<BillingGatewayView>("/billing/gateway");
      setGateway(response.data);
    } catch (error) {
      setLoadError(
        getApiErrorMessage(
          error,
          "Não foi possível carregar a configuração do gateway.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Toda ação devolve a configuração atualizada; erro sobe com a mensagem
  // do backend para a tela decidir onde mostrar.
  const run = useCallback(
    async <T,>(
      action: GatewayAction,
      request: () => Promise<T>,
      pick: (result: T) => BillingGatewayView,
      fallback: string,
    ) => {
      setBusy(action);
      try {
        const result = await request();
        setGateway(pick(result));
        return result;
      } catch (error) {
        throw new Error(getApiErrorMessage(error, fallback));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const setMode = useCallback(
    (mode: BillingGatewayMode) =>
      run(
        "mode",
        async () =>
          (await api.patch<BillingGatewayView>("/billing/gateway", {
            gateway: mode,
          })).data,
        (view) => view,
        "Não foi possível alterar o gateway.",
      ),
    [run],
  );

  const saveApiKey = useCallback(
    (apiKey: string) =>
      run(
        "saveKey",
        async () =>
          (await api.put<BillingGatewayView>(
            "/billing/gateway/asaas/credentials",
            { apiKey },
          )).data,
        (view) => view,
        "Não foi possível salvar a chave.",
      ),
    [run],
  );

  const testConnection = useCallback(
    () =>
      run(
        "test",
        async () =>
          (await api.post<BillingGatewayView>("/billing/gateway/asaas/test"))
            .data,
        (view) => view,
        "Não foi possível testar a conexão.",
      ),
    [run],
  );

  const removeApiKey = useCallback(
    () =>
      run(
        "remove",
        async () =>
          (await api.delete<BillingGatewayView>(
            "/billing/gateway/asaas/credentials",
          )).data,
        (view) => view,
        "Não foi possível remover a chave.",
      ),
    [run],
  );

  const configureWebhook = useCallback(
    () =>
      run(
        "webhook",
        async () =>
          (await api.post<WebhookSetupResult>("/billing/gateway/asaas/webhook"))
            .data,
        (result) => result.gateway,
        "Não foi possível configurar o webhook.",
      ),
    [run],
  );

  return {
    gateway,
    loading,
    loadError,
    busy,
    reload: load,
    setMode,
    saveApiKey,
    testConnection,
    removeApiKey,
    configureWebhook,
  };
}
