import { Logger } from '@nestjs/common';
import { AsaasApiError, AsaasErrorDetail } from './asaas-api.error';
import type { AsaasConfig } from './asaas.config';

export type FetchLike = typeof fetch;

export type AsaasCommercialInfo = {
  name: string | null;
  companyName: string | null;
  cpfCnpj: string | null;
  personType: string | null;
  status: string | null;
};

export type AsaasWebhookInput = {
  name: string;
  url: string;
  email: string;
  authToken: string;
  events: readonly string[];
};

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'UniPass/1.0 (NestJS)';

/**
 * Cliente HTTP da API v3 do Asaas para UMA chave (a da empresa).
 *
 * Regras: a chave só vai no header "access_token"; nada de chave, header ou
 * corpo nos logs; toda falha vira AsaasApiError (ver asaas-error.mapper.ts
 * para a mensagem ao usuário). Não repete POST sozinho — repetir criação
 * exige checar antes se o recurso já existe (idempotência é do chamador).
 */
export class AsaasClient {
  private readonly logger = new Logger(AsaasClient.name);

  constructor(
    private readonly config: AsaasConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** GET /myAccount/commercialInfo/ — só leitura; usado em "Testar conexão". */
  async getCommercialInfo(): Promise<AsaasCommercialInfo> {
    const body = await this.request(
      'commercialInfo',
      'GET',
      '/myAccount/commercialInfo/',
    );

    return {
      name: readString(body.name),
      companyName: readString(body.companyName),
      cpfCnpj: readString(body.cpfCnpj),
      personType: readString(body.personType),
      status: readString(body.status),
    };
  }

  /** POST /webhooks — cadastra o webhook de cobranças na conta da empresa. */
  async createWebhook(input: AsaasWebhookInput) {
    const body = await this.request(
      'createWebhook',
      'POST',
      '/webhooks',
      this.webhookBody(input),
    );

    return { id: readString(body.id) };
  }

  /** PUT /webhooks/{id} — troca URL/token do webhook já cadastrado. */
  async updateWebhook(webhookId: string, input: AsaasWebhookInput) {
    const body = await this.request(
      'updateWebhook',
      'PUT',
      `/webhooks/${encodeURIComponent(webhookId)}`,
      this.webhookBody(input),
    );

    return { id: readString(body.id) ?? webhookId };
  }

  private webhookBody(input: AsaasWebhookInput) {
    return {
      name: input.name,
      url: input.url,
      email: input.email,
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      authToken: input.authToken,
      sendType: 'SEQUENTIALLY',
      events: input.events,
    };
  }

  private async request(
    operation: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    payload?: unknown,
  ): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const kind =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'timeout'
          : 'network';
      this.logger.warn(`Asaas ${operation}: ${kind}.`);
      throw new AsaasApiError(kind, operation, null);
    }

    const body = await readJsonBody(response);

    if (response.ok) {
      return body ?? {};
    }

    const details = readErrorDetails(body);
    const error = new AsaasApiError(
      kindForStatus(response.status),
      operation,
      response.status,
      details,
      response.status === 429
        ? readRetryAfter(response.headers.get('RateLimit-Reset'))
        : null,
    );

    // Só o que ajuda a diagnosticar sem expor dado: operação, status e os
    // códigos de erro do Asaas (ex.: invalid_value), nunca as descrições.
    this.logger.warn(error.message);
    throw error;
  }
}

function kindForStatus(status: number): AsaasApiError['kind'] {
  if (status === 400) return 'validation';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'unexpected';
}

async function readJsonBody(response: Response) {
  try {
    const text = await response.text();
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// Formato oficial: { "errors": [{ "code": "...", "description": "..." }] }
function readErrorDetails(
  body: Record<string, unknown> | null,
): AsaasErrorDetail[] {
  const errors = body?.errors;

  if (!Array.isArray(errors)) {
    return [];
  }

  return errors
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object',
    )
    .map((item) => ({
      code: readString(item.code),
      description: readString(item.description),
    }));
}

function readRetryAfter(value: string | null) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
