export type BillingGatewayMode = "EXTERNAL" | "ASAAS";

export type BillingGatewayStatus =
  | "NOT_CONFIGURED"
  | "INCOMPLETE"
  | "CONFIGURED"
  | "VALIDATED"
  | "CONNECTION_ERROR"
  | "DISABLED";

/** GET /billing/gateway — nunca traz a chave de API, só o final dela. */
export type BillingGatewayView = {
  gateway: BillingGatewayMode;
  status: BillingGatewayStatus;
  readyToIssue: boolean;
  pendingSteps: string[];
  asaas: {
    environment: "sandbox" | "production" | null;
    environmentLabel: string | null;
    serverConfigured: boolean;
    hasApiKey: boolean;
    apiKeyLast4: string | null;
    environmentMismatch: boolean;
    connectionCheck: "UNTESTED" | "VALIDATED" | "FAILED";
    connectionCheckedAt: string | null;
    connectionError: string | null;
    accountName: string | null;
    accountDocumentMasked: string | null;
    webhook: {
      configured: boolean;
      configuredAt: string | null;
      automatic: boolean;
      autoRegistrationAvailable: boolean;
      url: string | null;
    };
  };
};

/** Resposta de POST /billing/gateway/asaas/webhook. */
export type WebhookSetupResult = {
  gateway: BillingGatewayView;
  webhookSetup:
    | { mode: "automatic"; url: string; path: string; authToken: null }
    | { mode: "manual"; url: null; path: string; authToken: string };
};

export const gatewayStatusMeta: Record<
  BillingGatewayStatus,
  {
    label: string;
    tone: "neutral" | "success" | "warning" | "danger" | "info";
  }
> = {
  NOT_CONFIGURED: { label: "Não configurado", tone: "neutral" },
  INCOMPLETE: { label: "Configuração incompleta", tone: "warning" },
  CONFIGURED: { label: "Configurado", tone: "info" },
  VALIDATED: { label: "Conexão validada", tone: "success" },
  CONNECTION_ERROR: { label: "Erro de conexão", tone: "danger" },
  DISABLED: { label: "Desativado", tone: "neutral" },
};
