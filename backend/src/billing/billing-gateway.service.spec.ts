import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AsaasConnectionCheck,
  BillingGatewayMode,
  CompanyBillingSettings,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasApiError } from './asaas/asaas-api.error';
import { AsaasClientFactory } from './asaas/asaas-client.factory';
import { AsaasClient } from './asaas/asaas.client';
import { AsaasConfigurationError } from './asaas/asaas.config';
import { BillingAuditService } from './billing-audit.service';
import { BillingGatewayService } from './billing-gateway.service';

const COMPANY_ID = 'company-1';
const SANDBOX_KEY = '$aact_hmlg_chave_de_teste_sandbox_000000001234';
const PROD_KEY = '$aact_prod_chave_de_producao_0000000000000000';
const ACTOR = {
  id: 'user-1',
  email: 'admin@empresa.test',
  companyId: COMPANY_ID,
  ip: '10.0.0.1',
};

function emptySettings(): CompanyBillingSettings {
  const now = new Date();
  return {
    id: 'settings-1',
    companyId: COMPANY_ID,
    gatewayMode: BillingGatewayMode.EXTERNAL,
    onboardingStatus: 'NOT_STARTED',
    gatewayContactName: null,
    gatewayContactEmail: null,
    gatewayContactPhone: null,
    legalEntityName: null,
    legalDocument: null,
    bankInfoSummary: null,
    defaultAmountCents: null,
    defaultDueDay: null,
    lgpdAcceptedAt: null,
    platformTermsAcceptedAt: null,
    submittedAt: null,
    reviewedAt: null,
    reviewNotes: null,
    asaasAccountId: null,
    asaasApiKeyEncrypted: null,
    asaasApiKeyLast4: null,
    asaasEnvironment: null,
    asaasConnectionCheck: AsaasConnectionCheck.UNTESTED,
    asaasConnectionCheckedAt: null,
    asaasConnectionError: null,
    asaasAccountName: null,
    asaasAccountDocumentMasked: null,
    asaasWebhookEndpointKey: null,
    asaasWebhookTokenHash: null,
    asaasWebhookId: null,
    asaasWebhookConfiguredAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Prisma em memória: só o que o BillingGatewayService usa.
function buildPrisma() {
  const state = { settings: emptySettings(), audits: [] as unknown[] };
  const prisma = {
    company: {
      findUnique: jest.fn(() => Promise.resolve({ id: COMPANY_ID })),
    },
    companyBillingSettings: {
      upsert: jest.fn(() => Promise.resolve(state.settings)),
      update: jest.fn(({ data }: { data: Partial<CompanyBillingSettings> }) => {
        state.settings = { ...state.settings, ...data };
        return Promise.resolve(state.settings);
      }),
    },
    billingEventLog: {
      create: jest.fn(({ data }: { data: unknown }) => {
        state.audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  return { prisma: prisma as unknown as PrismaService, state };
}

function buildAsaas(
  commercialInfo: () => Promise<unknown> = () =>
    Promise.resolve({
      name: 'Fulano',
      companyName: 'Transportes Teste',
      cpfCnpj: '12345678000190',
      personType: 'JURIDICA',
      status: 'APPROVED',
    }),
  environment: 'sandbox' | 'production' | null = 'sandbox',
) {
  const created: string[] = [];
  const client = {
    getCommercialInfo: jest.fn(commercialInfo),
    createWebhook: jest.fn(() => Promise.resolve({ id: 'wh_1' })),
    updateWebhook: jest.fn((id: string) => Promise.resolve({ id })),
  };
  const factory = {
    getConfig: () => {
      if (!environment) {
        throw new AsaasConfigurationError('ASAAS_ENV inválido');
      }
      return { apiUrl: 'https://api-sandbox.asaas.com/v3', environment };
    },
    create: (apiKey: string) => {
      created.push(apiKey);
      return client as unknown as AsaasClient;
    },
  };

  return {
    factory: factory as unknown as AsaasClientFactory,
    client,
    created,
  };
}

function buildService(
  options: {
    env?: Record<string, string>;
    asaas?: ReturnType<typeof buildAsaas>;
  } = {},
) {
  const { prisma, state } = buildPrisma();
  const asaas = options.asaas ?? buildAsaas();
  const config = new ConfigService({
    BILLING_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    ...options.env,
  });
  const service = new BillingGatewayService(
    prisma,
    config,
    asaas.factory,
    new BillingAuditService(prisma),
  );

  return { service, state, asaas };
}

describe('BillingGatewayService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sem nada configurado: gateway próprio, "não configurado" e pronto para emitir', async () => {
    const { service } = buildService();

    await expect(service.getGateway(COMPANY_ID)).resolves.toMatchObject({
      gateway: 'EXTERNAL',
      status: 'NOT_CONFIGURED',
      readyToIssue: true,
      pendingSteps: [],
    });
  });

  it('Asaas escolhido sem chave fica "incompleto" e não pode emitir', async () => {
    const { service } = buildService();

    await expect(
      service.setGateway(ACTOR, BillingGatewayMode.ASAAS),
    ).resolves.toMatchObject({
      gateway: 'ASAAS',
      status: 'INCOMPLETE',
      readyToIssue: false,
    });
  });

  it('salvar a chave cifra, guarda só o final e testa a conexão na hora', async () => {
    const { service, state, asaas } = buildService();
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);

    const view = await service.saveCredentials(ACTOR, SANDBOX_KEY);

    expect(state.settings.asaasApiKeyEncrypted).toBeTruthy();
    expect(state.settings.asaasApiKeyEncrypted).not.toContain(SANDBOX_KEY);
    expect(asaas.created).toEqual([SANDBOX_KEY]);
    expect(view).toMatchObject({
      // falta só o webhook
      status: 'INCOMPLETE',
      pendingSteps: ['Configurar o webhook de cobranças.'],
      asaas: {
        apiKeyLast4: '1234',
        connectionCheck: 'VALIDATED',
        accountName: 'Transportes Teste',
        accountDocumentMasked: '**.***.***/0001-90',
      },
    });
    expect(JSON.stringify(view)).not.toContain(SANDBOX_KEY);
  });

  it('com chave validada e webhook configurado fica "conexão validada"', async () => {
    const { service } = buildService();
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);
    await service.saveCredentials(ACTOR, SANDBOX_KEY);

    const { gateway, webhookSetup } = await service.configureWebhook(ACTOR);

    expect(gateway).toMatchObject({ status: 'VALIDATED', readyToIssue: true });
    // Sem ASAAS_WEBHOOK_PUBLIC_BASE_URL: token mostrado uma vez para cadastro manual.
    expect(webhookSetup.mode).toBe('manual');
    expect(webhookSetup.authToken).toMatch(/^[0-9a-f]{48}$/);
    expect(webhookSetup.path).toMatch(
      /^\/billing\/webhook\/asaas\/[0-9a-f]{32}$/,
    );
  });

  it('com ASAAS_WEBHOOK_PUBLIC_BASE_URL o webhook é cadastrado no Asaas e o token não volta', async () => {
    const { service, asaas, state } = buildService({
      env: { ASAAS_WEBHOOK_PUBLIC_BASE_URL: 'https://api.unipass.test/' },
    });
    await service.saveCredentials(ACTOR, SANDBOX_KEY);

    const { webhookSetup } = await service.configureWebhook(ACTOR);
    const sentToken = (
      asaas.client.createWebhook.mock.calls[0] as unknown as [
        { authToken: string; url: string; email: string },
      ]
    )[0];

    expect(webhookSetup).toMatchObject({ mode: 'automatic', authToken: null });
    expect(sentToken.url).toBe(
      `https://api.unipass.test/billing/webhook/asaas/${state.settings.asaasWebhookEndpointKey}`,
    );
    expect(sentToken.email).toBe(ACTOR.email);
    expect(state.settings.asaasWebhookTokenHash).not.toBe(sentToken.authToken);
    expect(state.settings.asaasWebhookId).toBe('wh_1');

    // Reconfigurar atualiza o mesmo webhook em vez de criar outro.
    await service.configureWebhook(ACTOR);
    expect(asaas.client.updateWebhook).toHaveBeenCalledWith(
      'wh_1',
      expect.anything(),
    );
    expect(asaas.client.createWebhook).toHaveBeenCalledTimes(1);
  });

  it('chave de produção com o servidor em sandbox: 400 explicando o prefixo, nada salvo', async () => {
    const { service, state, asaas } = buildService();

    const error = (await service
      .saveCredentials(ACTOR, PROD_KEY)
      .catch((caught: unknown) => caught)) as BadRequestException;

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('$aact_hmlg_');
    expect(state.settings.asaasApiKeyEncrypted).toBeNull();
    expect(asaas.created).toEqual([]);
  });

  it('chave recusada pelo Asaas: "erro de conexão" com mensagem amigável', async () => {
    const asaas = buildAsaas(() =>
      Promise.reject(new AsaasApiError('unauthorized', 'commercialInfo', 401)),
    );
    const { service, state } = buildService({ asaas });
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);

    const view = await service.saveCredentials(ACTOR, SANDBOX_KEY);

    expect(view.status).toBe('CONNECTION_ERROR');
    expect(view.asaas.connectionError).toContain('recusou a chave');
    expect(state.settings.asaasConnectionCheck).toBe('FAILED');
  });

  it('sem BILLING_ENCRYPTION_KEY recusa guardar a chave (503), sem chamar o Asaas', async () => {
    const { service, asaas } = buildService({
      env: { BILLING_ENCRYPTION_KEY: '' },
    });

    await expect(
      service.saveCredentials(ACTOR, SANDBOX_KEY),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(asaas.created).toEqual([]);
  });

  it('sem ASAAS_ENV/ASAAS_API_URL válidos recusa com 503', async () => {
    const { service } = buildService({
      asaas: buildAsaas(undefined, null),
    });

    await expect(
      service.saveCredentials(ACTOR, SANDBOX_KEY),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('testar sem chave salva dá 400', async () => {
    const { service } = buildService();

    await expect(service.testConnection(ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('voltar para gateway próprio com chave salva fica "desativado"', async () => {
    const { service } = buildService();
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);
    await service.saveCredentials(ACTOR, SANDBOX_KEY);

    await expect(
      service.setGateway(ACTOR, BillingGatewayMode.EXTERNAL),
    ).resolves.toMatchObject({ status: 'DISABLED', readyToIssue: true });
  });

  it('remover a chave apaga chave e token do webhook e volta para gateway próprio', async () => {
    const { service, state } = buildService();
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);
    await service.saveCredentials(ACTOR, SANDBOX_KEY);
    await service.configureWebhook(ACTOR);

    const view = await service.removeCredentials(ACTOR);

    expect(view).toMatchObject({
      gateway: 'EXTERNAL',
      status: 'NOT_CONFIGURED',
    });
    expect(state.settings.asaasApiKeyEncrypted).toBeNull();
    expect(state.settings.asaasWebhookTokenHash).toBeNull();
  });

  it('a auditoria registra quem fez e de onde, sem chave nem token', async () => {
    const { service, state } = buildService();
    await service.setGateway(ACTOR, BillingGatewayMode.ASAAS);
    await service.saveCredentials(ACTOR, SANDBOX_KEY);
    const { webhookSetup } = await service.configureWebhook(ACTOR);
    const audits = JSON.stringify(state.audits);

    expect(state.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'BILLING_GATEWAY_CHANGED',
          actorUserId: ACTOR.id,
          ip: ACTOR.ip,
          outcome: 'SUCCESS',
        }),
        expect.objectContaining({ eventType: 'ASAAS_CREDENTIALS_UPDATED' }),
        expect.objectContaining({ eventType: 'ASAAS_CONNECTION_TESTED' }),
        expect.objectContaining({ eventType: 'ASAAS_WEBHOOK_CONFIGURED' }),
      ]),
    );
    expect(audits).not.toContain(SANDBOX_KEY);
    expect(audits).not.toContain(webhookSetup.authToken as string);
  });
});
