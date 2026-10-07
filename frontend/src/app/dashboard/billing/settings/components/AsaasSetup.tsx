"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  PlugZap,
  Trash2,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import {
  ConfirmDialog,
  GhostButton,
  PrimaryButton,
  StatusBadge,
} from "@/app/dashboard/components/page-kit";
import { Panel, PanelHeader } from "@/app/dashboard/components/primitives";
import {
  FormField,
  fieldAccentStyle,
  fieldInputClass,
} from "@/app/dashboard/components/FormModal";
import { buildApiUrl } from "@/services/api";
import type { GatewayAction } from "../hooks/useBillingGateway";
import type {
  BillingGatewayView,
  WebhookSetupResult,
} from "../types/billing-gateway";

const KEY_PREFIX = {
  sandbox: "$aact_hmlg_",
  production: "$aact_prod_",
} as const;

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function StepNumber({ done, index }: { done: boolean; index: number }) {
  return done ? (
    <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
  ) : (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
      {index}
    </span>
  );
}

export function AsaasSetup({
  gateway,
  busy,
  onSaveKey,
  onTest,
  onConfigureWebhook,
  onRemove,
}: {
  gateway: BillingGatewayView;
  busy: GatewayAction | null;
  onSaveKey: (apiKey: string) => Promise<unknown>;
  onTest: () => Promise<unknown>;
  onConfigureWebhook: () => Promise<WebhookSetupResult>;
  onRemove: () => Promise<unknown>;
}) {
  const { asaas } = gateway;
  const [apiKey, setApiKey] = useState("");
  const [editingKey, setEditingKey] = useState(!asaas.hasApiKey);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [manualWebhook, setManualWebhook] = useState<{
    url: string;
    token: string;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const expectedPrefix = asaas.environment
    ? KEY_PREFIX[asaas.environment]
    : null;
  const keyStepDone = asaas.hasApiKey && !asaas.environmentMismatch;
  const connectionDone = keyStepDone && asaas.connectionCheck === "VALIDATED";

  async function handleSaveKey() {
    const trimmed = apiKey.trim();

    if (!trimmed) {
      setKeyError("Cole a chave de API gerada no painel do Asaas.");
      return;
    }

    if (expectedPrefix && !trimmed.startsWith(expectedPrefix)) {
      setKeyError(
        `Esta chave não é do ambiente ${asaas.environmentLabel}. Chaves desse ambiente começam com "${expectedPrefix}".`,
      );
      return;
    }

    setKeyError(null);
    try {
      await onSaveKey(trimmed);
      // A chave sai do estado da tela assim que o backend a recebe.
      setApiKey("");
      setEditingKey(false);
      toast.success("Chave salva. Testamos a conexão em seguida.");
    } catch (error) {
      setKeyError((error as Error).message);
    }
  }

  async function handleTest() {
    try {
      await onTest();
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function handleWebhook() {
    try {
      const result = await onConfigureWebhook();

      if (result.webhookSetup.mode === "manual") {
        setManualWebhook({
          url: buildApiUrl(result.webhookSetup.path),
          token: result.webhookSetup.authToken,
        });
      } else {
        setManualWebhook(null);
        toast.success("Webhook cadastrado na sua conta Asaas.");
      }
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function handleRemove() {
    try {
      await onRemove();
      setConfirmRemove(false);
      setEditingKey(true);
      setManualWebhook(null);
      toast.success("Chave removida. A empresa voltou para o gateway próprio.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado.`);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Configuração do Asaas"
        hint={
          asaas.environmentLabel
            ? `Ambiente em uso: ${asaas.environmentLabel}`
            : undefined
        }
        action={
          asaas.environment && (
            <StatusBadge
              tone={asaas.environment === "production" ? "accent" : "info"}
            >
              {asaas.environment === "production" ? "Produção" : "Sandbox"}
            </StatusBadge>
          )
        }
      />

      <div className="space-y-6 p-5">
        {!asaas.serverConfigured && (
          <div className="flex gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            O servidor do UniPass ainda não está configurado para o Asaas.
            Fale com o suporte antes de continuar.
          </div>
        )}

        {/* 1. Chave de API */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <StepNumber done={keyStepDone} index={1} />
            <h3 className="text-sm font-semibold">Chave de API</h3>
          </div>

          {asaas.environmentMismatch && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              A chave salva é de outro ambiente. Salve uma chave de{" "}
              {asaas.environmentLabel}.
            </p>
          )}

          {!editingKey && asaas.hasApiKey ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 font-mono text-sm">
                <KeyRound size={14} className="text-muted-foreground" />
                •••• {asaas.apiKeyLast4}
              </span>
              <GhostButton onClick={() => setEditingKey(true)}>
                Trocar chave
              </GhostButton>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveKey();
              }}
            >
              <FormField
                label="Chave de API do Asaas"
                hint={`Gere no painel do Asaas em Integrações → Chave de API.${
                  expectedPrefix ? ` Começa com "${expectedPrefix}".` : ""
                } Depois de salva, ela não aparece mais.`}
                error={keyError}
              >
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={expectedPrefix ? `${expectedPrefix}...` : ""}
                  className={`${fieldInputClass} font-mono`}
                  style={fieldAccentStyle}
                />
              </FormField>
              <div className="flex gap-2">
                <PrimaryButton
                  type="submit"
                  disabled={busy !== null || !asaas.serverConfigured}
                >
                  {busy === "saveKey" && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  Salvar e testar
                </PrimaryButton>
                {asaas.hasApiKey && (
                  <GhostButton
                    onClick={() => {
                      setEditingKey(false);
                      setApiKey("");
                      setKeyError(null);
                    }}
                  >
                    Cancelar
                  </GhostButton>
                )}
              </div>
            </form>
          )}
        </section>

        {/* 2. Conexão */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <StepNumber done={connectionDone} index={2} />
            <h3 className="text-sm font-semibold">Conexão</h3>
          </div>

          {asaas.connectionCheck === "VALIDATED" && (
            <p className="text-sm text-muted-foreground">
              Conta conectada:{" "}
              <span className="font-medium text-foreground">
                {asaas.accountName ?? "sem nome informado"}
              </span>
              {asaas.accountDocumentMasked &&
                ` · ${asaas.accountDocumentMasked}`}
              {asaas.connectionCheckedAt &&
                ` · testada em ${formatDateTime(asaas.connectionCheckedAt)}`}
            </p>
          )}
          {asaas.connectionCheck === "FAILED" && asaas.connectionError && (
            <div className="flex gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <div>
                <p>{asaas.connectionError}</p>
                {asaas.connectionCheckedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Último teste: {formatDateTime(asaas.connectionCheckedAt)}
                  </p>
                )}
              </div>
            </div>
          )}
          {asaas.connectionCheck === "UNTESTED" && (
            <p className="text-sm text-muted-foreground">
              {asaas.hasApiKey
                ? "A chave ainda não foi testada."
                : "Salve a chave para testar a conexão."}
            </p>
          )}

          <GhostButton
            onClick={() => void handleTest()}
            disabled={!keyStepDone || busy !== null}
          >
            {busy === "test" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PlugZap size={14} />
            )}
            Testar conexão
          </GhostButton>
          <p className="text-xs text-muted-foreground">
            O teste só lê os dados da conta no Asaas. Nenhuma cobrança é criada.
          </p>
        </section>

        {/* 3. Webhook */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <StepNumber done={asaas.webhook.configured} index={3} />
            <h3 className="text-sm font-semibold">Webhook de cobranças</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            É por ele que o Asaas avisa o UniPass sobre pagamentos, vencimentos
            e cancelamentos.
            {asaas.webhook.configured &&
              asaas.webhook.configuredAt &&
              ` Configurado em ${formatDateTime(asaas.webhook.configuredAt)}${
                asaas.webhook.automatic ? " (cadastrado automaticamente)" : ""
              }.`}
          </p>

          {manualWebhook && (
            <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium">
                Cadastre um webhook de cobranças na sua conta Asaas com estes
                dados:
              </p>
              {[
                { label: "URL", value: manualWebhook.url },
                { label: "Token de autenticação", value: manualWebhook.token },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-lg border border-border/60 bg-background px-2 py-1.5 text-xs">
                      {item.value}
                    </code>
                    <GhostButton
                      aria-label={`Copiar ${item.label}`}
                      onClick={() => void copy(item.value, item.label)}
                    >
                      <Copy size={13} />
                    </GhostButton>
                  </div>
                </div>
              ))}
              <p className="text-xs">
                O token aparece só agora. Se perder, gere outro — o anterior
                deixa de valer.
              </p>
              {!manualWebhook.url.startsWith("https://") && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Este endereço não usa https e parece ser local: o Asaas não
                  consegue entregar eventos aqui. Em produção, use o endereço
                  público da API.
                </p>
              )}
            </div>
          )}

          <GhostButton
            onClick={() => void handleWebhook()}
            disabled={!keyStepDone || busy !== null}
          >
            {busy === "webhook" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Webhook size={14} />
            )}
            {asaas.webhook.configured
              ? "Gerar novo token do webhook"
              : asaas.webhook.autoRegistrationAvailable
                ? "Cadastrar webhook no Asaas"
                : "Gerar URL e token do webhook"}
          </GhostButton>
        </section>

        {asaas.hasApiKey && (
          <div className="border-t border-border/60 pt-4">
            <GhostButton
              tone="danger"
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
            >
              <Trash2 size={14} />
              Remover chave do Asaas
            </GhostButton>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        onConfirm={() => void handleRemove()}
        title="Remover a chave do Asaas?"
        description="A chave e o token do webhook são apagados do UniPass e a empresa volta para o gateway próprio."
        consequence="Remova também o webhook no painel do Asaas: sem o token, os avisos que ele mandar serão recusados."
        confirmLabel="Remover chave"
        busy={busy === "remove"}
      />
    </Panel>
  );
}
