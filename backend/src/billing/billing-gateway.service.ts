import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AsaasConnectionCheck,
  BillingAuditOutcome,
  BillingGatewayMode,
  CompanyBillingSettings,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasApiError } from './asaas/asaas-api.error';
import { AsaasClientFactory } from './asaas/asaas-client.factory';
import { describeAsaasError } from './asaas/asaas-error.mapper';
import {
  ASAAS_PAYMENT_WEBHOOK_EVENTS,
  ASAAS_WEBHOOK_PATH,
} from './asaas/asaas-webhook-events';
import {
  ASAAS_ENVIRONMENT_LABEL,
  ASAAS_KEY_PREFIX,
  AsaasConfig,
  AsaasConfigurationError,
  AsaasEnvironment,
  keyMatchesEnvironment,
} from './asaas/asaas.config';
import {
  BillingAuditAction,
  BillingAuditService,
} from './billing-audit.service';
import {
  BillingEncryptionKeyError,
  decryptSecret,
  encryptSecret,
  generateSecretToken,
  hashSecret,
  lastFour,
  maskDocument,
  parseEncryptionKey,
} from './billing-crypto.util';
import {
  ensureCompanyBillingSettings,
  requireBillingCompanyId,
} from './billing-settings.util';

export type BillingActor = {
  id: string;
  companyId: string | null;
  email: string;
  ip?: string | null;
};

/** Situação mostrada na tela "Gateway de cobrança". */
export type BillingGatewayStatus =
  | 'NOT_CONFIGURED'
  | 'INCOMPLETE'
  | 'CONFIGURED'
  | 'VALIDATED'
  | 'CONNECTION_ERROR'
  | 'DISABLED';

const WEBHOOK_NAME = 'UniPass - cobranças';

/**
 * Escolha e configuração do gateway de cobrança de cada empresa:
 * EXTERNAL (processo próprio, nada chama o Asaas) ou ASAAS (conta Asaas da
 * empresa). A chave de API entra aqui, sai cifrada para o banco e nunca volta
 * para o cliente — só os 4 últimos caracteres.
 */
@Injectable()
export class BillingGatewayService {
  private readonly logger = new Logger(BillingGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly asaasClients: AsaasClientFactory,
    private readonly audit: BillingAuditService,
  ) {}

  async getGateway(companyId: string | null | undefined) {
    const settings = await ensureCompanyBillingSettings(
      this.prisma,
      requireBillingCompanyId(companyId),
    );

    return this.toView(settings);
  }

  async setGateway(actor: BillingActor, gateway: BillingGatewayMode) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const current = await ensureCompanyBillingSettings(this.prisma, companyId);

    const updated = await this.prisma.companyBillingSettings.update({
      where: { companyId },
      data: { gatewayMode: gateway },
    });

    if (current.gatewayMode !== gateway) {
      await this.audit.record({
        companyId,
        actorUserId: actor.id,
        ip: actor.ip,
        action: BillingAuditAction.GATEWAY_CHANGED,
        outcome: BillingAuditOutcome.SUCCESS,
        metadata: { from: current.gatewayMode, to: gateway },
      });
    }

    return this.toView(updated);
  }

  /** Salva (ou troca) a chave e já testa a conexão com ela. */
  async saveCredentials(actor: BillingActor, apiKey: string) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const config = this.readConfig();
    const encryptionKey = this.readEncryptionKey();
    await ensureCompanyBillingSettings(this.prisma, companyId);

    if (!keyMatchesEnvironment(apiKey, config.environment)) {
      await this.audit.record({
        companyId,
        actorUserId: actor.id,
        ip: actor.ip,
        action: BillingAuditAction.ASAAS_CREDENTIALS_UPDATED,
        outcome: BillingAuditOutcome.FAILURE,
        metadata: { reason: 'environment_mismatch' },
      });

      throw new BadRequestException(
        `Esta chave não é do ambiente ${ASAAS_ENVIRONMENT_LABEL[config.environment]}, ` +
          `que é o que o UniPass está usando. Chaves desse ambiente começam com "${ASAAS_KEY_PREFIX[config.environment]}".`,
      );
    }

    await this.prisma.companyBillingSettings.update({
      where: { companyId },
      data: {
        asaasApiKeyEncrypted: encryptSecret(apiKey, encryptionKey),
        asaasApiKeyLast4: lastFour(apiKey),
        asaasEnvironment: config.environment,
        asaasConnectionCheck: AsaasConnectionCheck.UNTESTED,
        asaasConnectionCheckedAt: null,
        asaasConnectionError: null,
        asaasAccountName: null,
        asaasAccountDocumentMasked: null,
      },
    });

    // Os ids de cliente no Asaas são da conta. Com chave nova (talvez de
    // outra conta), cada pagador é procurado de novo pelo externalReference
    // na próxima emissão — na mesma conta ele é reencontrado, sem duplicar.
    await this.prisma.billingCustomer.updateMany({
      where: { companyId, asaasCustomerId: { not: null } },
      data: { asaasCustomerId: null, asaasSyncedAt: null },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.ASAAS_CREDENTIALS_UPDATED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: {
        keyEnding: lastFour(apiKey),
        environment: config.environment,
      },
    });

    return this.toView(
      await this.runConnectionTest(actor, companyId, apiKey, config),
    );
  }

  /** "Testar conexão": só leitura no Asaas, nenhuma cobrança é criada. */
  async testConnection(actor: BillingActor) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const config = this.readConfig();
    const settings = await ensureCompanyBillingSettings(this.prisma, companyId);

    if (!settings.asaasApiKeyEncrypted) {
      throw new BadRequestException(
        'Salve a chave de API do Asaas antes de testar a conexão.',
      );
    }

    if (settings.asaasEnvironment !== config.environment) {
      throw new BadRequestException(
        this.environmentMismatchMessage(settings, config),
      );
    }

    const apiKey = this.decryptApiKey(settings);

    if (!apiKey) {
      const updated = await this.markConnection(companyId, {
        check: AsaasConnectionCheck.FAILED,
        error:
          'A chave salva não pôde ser lida. Salve a chave de API novamente.',
      });
      await this.auditConnection(actor, companyId, false, {
        reason: 'decrypt_failed',
      });
      return this.toView(updated);
    }

    return this.toView(
      await this.runConnectionTest(actor, companyId, apiKey, config),
    );
  }

  /** Apaga chave e token do webhook e volta para o gateway próprio. */
  async removeCredentials(actor: BillingActor) {
    const companyId = requireBillingCompanyId(actor.companyId);
    await ensureCompanyBillingSettings(this.prisma, companyId);

    const updated = await this.prisma.companyBillingSettings.update({
      where: { companyId },
      data: {
        gatewayMode: BillingGatewayMode.EXTERNAL,
        asaasApiKeyEncrypted: null,
        asaasApiKeyLast4: null,
        asaasEnvironment: null,
        asaasConnectionCheck: AsaasConnectionCheck.UNTESTED,
        asaasConnectionCheckedAt: null,
        asaasConnectionError: null,
        asaasAccountName: null,
        asaasAccountDocumentMasked: null,
        asaasWebhookTokenHash: null,
        asaasWebhookId: null,
        asaasWebhookConfiguredAt: null,
      },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.ASAAS_CREDENTIALS_REMOVED,
      outcome: BillingAuditOutcome.SUCCESS,
    });

    return this.toView(updated);
  }

  /**
   * Gera um token novo para o webhook. Com ASAAS_WEBHOOK_PUBLIC_BASE_URL
   * (https), cadastra/atualiza o webhook direto na conta Asaas da empresa;
   * sem ela, devolve URL + token UMA vez para o admin cadastrar no painel do
   * Asaas. O banco guarda só o hash do token.
   */
  async configureWebhook(actor: BillingActor) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const config = this.readConfig();
    const settings = await ensureCompanyBillingSettings(this.prisma, companyId);

    if (!settings.asaasApiKeyEncrypted) {
      throw new BadRequestException(
        'Salve e teste a chave de API do Asaas antes de configurar o webhook.',
      );
    }

    const endpointKey =
      settings.asaasWebhookEndpointKey ?? randomBytes(16).toString('hex');
    const token = generateSecretToken();
    const path = `${ASAAS_WEBHOOK_PATH}/${endpointKey}`;
    const baseUrl = this.readWebhookBaseUrl();
    const url = baseUrl ? `${baseUrl}${path}` : null;
    let webhookId: string | null = null;

    if (url) {
      if (settings.asaasEnvironment !== config.environment) {
        throw new BadRequestException(
          this.environmentMismatchMessage(settings, config),
        );
      }

      const apiKey = this.decryptApiKey(settings);

      if (!apiKey) {
        throw new BadRequestException(
          'A chave salva não pôde ser lida. Salve a chave de API novamente.',
        );
      }

      const client = this.asaasClients.create(apiKey);
      const input = {
        name: WEBHOOK_NAME,
        url,
        email: actor.email,
        authToken: token,
        events: ASAAS_PAYMENT_WEBHOOK_EVENTS,
      };

      try {
        webhookId = settings.asaasWebhookId
          ? (await client.updateWebhook(settings.asaasWebhookId, input)).id
          : (await client.createWebhook(input)).id;
      } catch (error) {
        await this.audit.record({
          companyId,
          actorUserId: actor.id,
          ip: actor.ip,
          action: BillingAuditAction.ASAAS_WEBHOOK_CONFIGURED,
          outcome: BillingAuditOutcome.FAILURE,
          metadata: this.errorMetadata(error),
        });

        throw new BadGatewayException(
          describeAsaasError(error, config.environment),
        );
      }
    }

    const updated = await this.prisma.companyBillingSettings.update({
      where: { companyId },
      data: {
        asaasWebhookEndpointKey: endpointKey,
        asaasWebhookTokenHash: hashSecret(token),
        asaasWebhookId: webhookId,
        asaasWebhookConfiguredAt: new Date(),
      },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.ASAAS_WEBHOOK_CONFIGURED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: { mode: url ? 'automatic' : 'manual' },
    });

    return {
      gateway: this.toView(updated),
      webhookSetup: url
        ? { mode: 'automatic' as const, url, path, authToken: null }
        : { mode: 'manual' as const, url: null, path, authToken: token },
    };
  }

  /**
   * Cliente Asaas para emitir em nome da empresa. Recusa (400, com o que
   * falta) se o gateway não for Asaas ou a configuração não estiver pronta —
   * nesse caso nenhuma chamada ao Asaas acontece.
   */
  async getIssuingClient(companyId: string) {
    const settings = await ensureCompanyBillingSettings(this.prisma, companyId);
    const view = this.toView(settings);

    if (settings.gatewayMode !== BillingGatewayMode.ASAAS) {
      throw new BadRequestException(
        'A empresa usa gateway próprio: esta cobrança não vai para o Asaas.',
      );
    }

    if (!view.readyToIssue) {
      throw new BadRequestException(
        `A integração com o Asaas não está pronta. Falta: ${view.pendingSteps.join(' ')}`,
      );
    }

    const apiKey = this.decryptApiKey(settings);

    if (!apiKey) {
      throw new BadRequestException(
        'A chave do Asaas salva não pôde ser lida. Salve a chave de API novamente em Gateway de cobrança.',
      );
    }

    const config = this.readConfig();

    return {
      client: this.asaasClients.create(apiKey),
      environment: config.environment,
    };
  }

  /** Resumo do gateway para a emissão decidir o caminho (sem chamar o Asaas). */
  async getIssuingMode(companyId: string) {
    const settings = await ensureCompanyBillingSettings(this.prisma, companyId);
    const view = this.toView(settings);

    return {
      gateway: settings.gatewayMode,
      readyToIssue: view.readyToIssue,
      pendingSteps: view.pendingSteps,
    };
  }

  private async runConnectionTest(
    actor: BillingActor,
    companyId: string,
    apiKey: string,
    config: AsaasConfig,
  ) {
    try {
      const info = await this.asaasClients.create(apiKey).getCommercialInfo();
      const updated = await this.markConnection(companyId, {
        check: AsaasConnectionCheck.VALIDATED,
        error: null,
        accountName: info.companyName ?? info.name,
        accountDocumentMasked: maskDocument(info.cpfCnpj),
      });
      await this.auditConnection(actor, companyId, true, {
        environment: config.environment,
      });
      return updated;
    } catch (error) {
      const updated = await this.markConnection(companyId, {
        check: AsaasConnectionCheck.FAILED,
        error: describeAsaasError(error, config.environment),
      });
      await this.auditConnection(actor, companyId, false, {
        environment: config.environment,
        ...this.errorMetadata(error),
      });
      return updated;
    }
  }

  private markConnection(
    companyId: string,
    result: {
      check: AsaasConnectionCheck;
      error: string | null;
      accountName?: string | null;
      accountDocumentMasked?: string | null;
    },
  ) {
    return this.prisma.companyBillingSettings.update({
      where: { companyId },
      data: {
        asaasConnectionCheck: result.check,
        asaasConnectionCheckedAt: new Date(),
        asaasConnectionError: result.error,
        ...(result.check === AsaasConnectionCheck.VALIDATED
          ? {
              asaasAccountName: result.accountName ?? null,
              asaasAccountDocumentMasked: result.accountDocumentMasked ?? null,
            }
          : {}),
      },
    });
  }

  private auditConnection(
    actor: BillingActor,
    companyId: string,
    ok: boolean,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.ASAAS_CONNECTION_TESTED,
      outcome: ok ? BillingAuditOutcome.SUCCESS : BillingAuditOutcome.FAILURE,
      metadata,
    });
  }

  private errorMetadata(error: unknown) {
    return error instanceof AsaasApiError
      ? {
          errorKind: error.kind,
          httpStatus: error.status,
          errorCodes: error.details.map((detail) => detail.code),
        }
      : { errorKind: 'internal' };
  }

  private decryptApiKey(settings: CompanyBillingSettings) {
    if (!settings.asaasApiKeyEncrypted) {
      return null;
    }

    try {
      return decryptSecret(
        settings.asaasApiKeyEncrypted,
        this.readEncryptionKey(),
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.error(
        `Chave Asaas da empresa ${settings.companyId} não pôde ser decifrada.`,
      );
      return null;
    }
  }

  private readConfig() {
    try {
      return this.asaasClients.getConfig();
    } catch (error) {
      if (error instanceof AsaasConfigurationError) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException(
          'A integração com o Asaas não está configurada neste servidor. Fale com o suporte do UniPass.',
        );
      }

      throw error;
    }
  }

  private tryReadConfig() {
    try {
      return this.asaasClients.getConfig();
    } catch {
      return null;
    }
  }

  private readEncryptionKey() {
    try {
      return parseEncryptionKey(
        this.configService.get<string>('BILLING_ENCRYPTION_KEY'),
      );
    } catch (error) {
      if (error instanceof BillingEncryptionKeyError) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException(
          'O servidor não está pronto para guardar credenciais com segurança. Fale com o suporte do UniPass.',
        );
      }

      throw error;
    }
  }

  private readWebhookBaseUrl() {
    const raw = this.configService
      .get<string>('ASAAS_WEBHOOK_PUBLIC_BASE_URL')
      ?.trim();

    if (!raw) {
      return null;
    }

    if (!raw.startsWith('https://')) {
      this.logger.warn(
        'ASAAS_WEBHOOK_PUBLIC_BASE_URL ignorada: precisa começar com https://.',
      );
      return null;
    }

    return raw.replace(/\/+$/, '');
  }

  private environmentMismatchMessage(
    settings: CompanyBillingSettings,
    config: AsaasConfig,
  ) {
    const saved = settings.asaasEnvironment as AsaasEnvironment | null;

    return (
      `A chave salva é do ambiente ${saved ? ASAAS_ENVIRONMENT_LABEL[saved] : 'desconhecido'}, ` +
      `mas o UniPass está usando ${ASAAS_ENVIRONMENT_LABEL[config.environment]}. Salve uma chave deste ambiente.`
    );
  }

  private toView(settings: CompanyBillingSettings) {
    const config = this.tryReadConfig();
    const hasApiKey = !!settings.asaasApiKeyEncrypted;
    const environmentMismatch =
      hasApiKey && !!config && settings.asaasEnvironment !== config.environment;
    const webhookConfigured =
      !!settings.asaasWebhookEndpointKey && !!settings.asaasWebhookTokenHash;
    const isAsaas = settings.gatewayMode === BillingGatewayMode.ASAAS;
    const pendingSteps: string[] = [];

    if (isAsaas) {
      if (!config) {
        pendingSteps.push(
          'O servidor do UniPass ainda não está configurado para o Asaas.',
        );
      }
      if (!hasApiKey) {
        pendingSteps.push('Salvar a chave de API do Asaas.');
      } else if (environmentMismatch) {
        pendingSteps.push('Salvar uma chave do ambiente em uso.');
      } else if (
        settings.asaasConnectionCheck !== AsaasConnectionCheck.VALIDATED
      ) {
        pendingSteps.push('Testar a conexão com sucesso.');
      }
      if (!webhookConfigured) {
        pendingSteps.push('Configurar o webhook de cobranças.');
      }
    }

    const status = this.resolveStatus({
      isAsaas,
      hasApiKey,
      environmentMismatch,
      configMissing: !config,
      check: settings.asaasConnectionCheck,
      webhookConfigured,
    });
    const baseUrl = this.readWebhookBaseUrl();
    const environment = config?.environment ?? null;

    return {
      gateway: settings.gatewayMode,
      status,
      readyToIssue: isAsaas ? status === 'VALIDATED' : true,
      pendingSteps,
      asaas: {
        environment,
        environmentLabel: environment
          ? ASAAS_ENVIRONMENT_LABEL[environment]
          : null,
        serverConfigured: !!config,
        hasApiKey,
        apiKeyLast4: settings.asaasApiKeyLast4,
        environmentMismatch,
        connectionCheck: settings.asaasConnectionCheck,
        connectionCheckedAt: settings.asaasConnectionCheckedAt,
        connectionError: settings.asaasConnectionError,
        accountName: settings.asaasAccountName,
        accountDocumentMasked: settings.asaasAccountDocumentMasked,
        webhook: {
          configured: webhookConfigured,
          configuredAt: settings.asaasWebhookConfiguredAt,
          automatic: !!settings.asaasWebhookId,
          autoRegistrationAvailable: !!baseUrl,
          url:
            baseUrl && settings.asaasWebhookEndpointKey
              ? `${baseUrl}${ASAAS_WEBHOOK_PATH}/${settings.asaasWebhookEndpointKey}`
              : null,
        },
      },
    };
  }

  private resolveStatus(params: {
    isAsaas: boolean;
    hasApiKey: boolean;
    environmentMismatch: boolean;
    configMissing: boolean;
    check: AsaasConnectionCheck;
    webhookConfigured: boolean;
  }): BillingGatewayStatus {
    if (!params.isAsaas) {
      return params.hasApiKey ? 'DISABLED' : 'NOT_CONFIGURED';
    }

    if (
      !params.hasApiKey ||
      params.configMissing ||
      params.environmentMismatch
    ) {
      return 'INCOMPLETE';
    }

    if (params.check === AsaasConnectionCheck.FAILED) {
      return 'CONNECTION_ERROR';
    }

    if (params.check === AsaasConnectionCheck.UNTESTED) {
      return 'CONFIGURED';
    }

    return params.webhookConfigured ? 'VALIDATED' : 'INCOMPLETE';
  }
}
