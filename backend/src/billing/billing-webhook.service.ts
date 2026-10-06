import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingChargeStatus,
  BillingEventSource,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { safeCompareStrings } from '../security/secure-compare.util';
import { hashSecret } from './billing-crypto.util';

type AsaasWebhookPayload = Record<string, unknown>;
type HeaderValue = string | string[] | undefined;
type RequestHeaders = Record<string, HeaderValue>;
type BillingDataClient = Prisma.TransactionClient | PrismaService;

type HandleAsaasWebhookInput = {
  payload: AsaasWebhookPayload;
  headers?: RequestHeaders;
  rawBody?: Buffer;
  remoteIp?: string | null;
};

type ParsedAsaasWebhook = {
  payload: AsaasWebhookPayload;
  account: Record<string, unknown> | null;
  payment: Record<string, unknown> | null;
  event: string;
  eventId: string | null;
  webhookCreatedAtRaw: string | null;
  webhookCreatedAt: Date | null;
  asaasAccountId: string | null;
  gatewayChargeId: string | null;
  externalReference: string | null;
  asaasCustomerId: string | null;
  // Empresa dona da URL do webhook (rota por empresa); null na rota legada.
  endpointCompanyId: string | null;
  deduplicationKey: string;
  payloadHash: string;
};

type SecurityValidationResult = {
  remoteIp: string | null;
  tokenValidated: boolean;
  ipWhitelistApplied: boolean;
};

type ChargeUpdatePlan = {
  updateData: Prisma.BillingChargeUpdateInput;
  statusChanged: boolean;
  statusTimestampApplied: boolean;
};

type ResolvedWebhookTargets = {
  companyId: string | null;
  matchedBy: 'gatewayChargeId' | 'externalReference' | null;
  charge: {
    id: string;
    companyId: string;
    customerId: string | null;
    gatewayChargeId: string | null;
    externalReference: string | null;
    gatewayStatus: string | null;
    gatewayInvoiceUrl: string | null;
    bankSlipUrl: string | null;
    status: BillingChargeStatus;
    paidAt: Date | null;
    gatewayStatusUpdatedAt: Date | null;
  } | null;
  customer: {
    id: string;
    companyId: string;
  } | null;
};

const BILLING_WEBHOOK_EVENT_LOCK_NAMESPACE = 41_001;
const BILLING_CHARGE_LOCK_NAMESPACE = 41_002;

@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Rota legada (POST /billing/webhook/asaas), de antes do Asaas por empresa:
   * só aceita com ASAAS_WEBHOOK_TOKEN configurado e enviado no header
   * "asaas-access-token". Sem token configurado, recusa tudo.
   */
  async handleAsaasWebhook(input: HandleAsaasWebhookInput) {
    this.assertPayloadShape(input.payload);

    const security = this.assertAsaasWebhookSecurity({
      headers: input.headers,
      remoteIp: input.remoteIp,
    });

    return this.receiveWebhook(input, security, null);
  }

  /**
   * Webhook da conta Asaas de UMA empresa
   * (POST /billing/webhook/asaas/:endpointKey). A empresa vem da chave da URL
   * e o token do header precisa bater com o hash salvo para ela; a cobrança
   * só é procurada dentro dessa empresa.
   */
  async handleCompanyAsaasWebhook(
    input: HandleAsaasWebhookInput & { endpointKey: string },
  ) {
    this.assertPayloadShape(input.payload);

    const settings = await this.prisma.companyBillingSettings.findUnique({
      where: {
        asaasWebhookEndpointKey: input.endpointKey,
      },
      select: {
        companyId: true,
        asaasWebhookTokenHash: true,
      },
    });
    const providedToken = this.readHeaderValue(
      input.headers ?? {},
      'asaas-access-token',
    );

    // Mesma resposta para URL desconhecida e token errado: não revela quais
    // chaves de URL existem.
    if (
      !settings?.asaasWebhookTokenHash ||
      !providedToken ||
      !safeCompareStrings(
        hashSecret(providedToken),
        settings.asaasWebhookTokenHash,
      )
    ) {
      throw new UnauthorizedException('Invalid Asaas webhook token');
    }

    const remoteIp = this.resolveRemoteIp(input.remoteIp);
    const ipWhitelistApplied = this.assertAsaasWebhookIpWhitelist(remoteIp);

    return this.receiveWebhook(
      input,
      {
        remoteIp,
        tokenValidated: true,
        ipWhitelistApplied,
      },
      settings.companyId,
    );
  }

  private assertPayloadShape(payload: AsaasWebhookPayload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Invalid Asaas webhook payload');
    }
  }

  private async receiveWebhook(
    input: HandleAsaasWebhookInput,
    security: SecurityValidationResult,
    endpointCompanyId: string | null,
  ) {
    const parsed = this.parseAsaasWebhookPayload(
      input.payload,
      input.rawBody,
      endpointCompanyId,
    );
    const eventLog = await this.persistIncomingWebhookEvent({
      parsed,
      security,
    });

    let queued = false;

    if (!eventLog.processedAt) {
      queued = await this.enqueueWebhookProcessing(eventLog.id);
    }

    // O Asaas só precisa do 200. Nada de ids internos (empresa, cobrança,
    // log) na resposta para quem está do outro lado do webhook.
    return {
      received: true,
      duplicate: !eventLog.created,
      queued,
    };
  }

  async processWebhookEventLog(eventLogId: string) {
    const eventLog = await this.prisma.billingEventLog.findUnique({
      where: {
        id: eventLogId,
      },
      select: {
        id: true,
        payload: true,
        metadata: true,
        processedAt: true,
      },
    });

    if (!eventLog) {
      return {
        processed: false,
        missing: true,
        eventLogId,
      };
    }

    if (eventLog.processedAt) {
      return {
        processed: true,
        alreadyProcessed: true,
        eventLogId,
      };
    }

    const payload = this.readObject(eventLog.payload);

    if (!payload) {
      await this.finalizeInvalidWebhookEvent(eventLogId, eventLog.metadata);

      return {
        processed: true,
        ignored: true,
        reason: 'invalid_payload',
        eventLogId,
      };
    }

    const endpointCompanyId = this.readMetadataString(
      eventLog.metadata,
      'endpointCompanyId',
    );
    const parsed = this.parseAsaasWebhookPayload(
      payload,
      undefined,
      endpointCompanyId,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.acquireTransactionLock(
          tx,
          BILLING_WEBHOOK_EVENT_LOCK_NAMESPACE,
          eventLogId,
        );

        const latestEventLog = await tx.billingEventLog.findUnique({
          where: {
            id: eventLogId,
          },
          select: {
            id: true,
            metadata: true,
            processedAt: true,
          },
        });

        if (!latestEventLog) {
          return {
            processed: false,
            missing: true,
            eventLogId,
          };
        }

        if (latestEventLog.processedAt) {
          return {
            processed: true,
            alreadyProcessed: true,
            eventLogId,
          };
        }

        const targets = await this.resolveWebhookTargets(tx, parsed);
        let lockedCharge = targets.charge;

        if (lockedCharge) {
          await this.acquireTransactionLock(
            tx,
            BILLING_CHARGE_LOCK_NAMESPACE,
            lockedCharge.id,
          );
          lockedCharge = await this.getChargeSnapshot(tx, lockedCharge.id);
        }

        let staleEvent = this.isStaleWebhookEvent({
          charge: lockedCharge,
          webhookCreatedAt: parsed.webhookCreatedAt,
        });
        const chargeUpdatePlan =
          lockedCharge && !staleEvent
            ? this.buildChargeUpdateFromAsaasWebhook({
                charge: lockedCharge,
                customerId: targets.customer?.id,
                payment: parsed.payment,
                event: parsed.event,
                webhookCreatedAt: parsed.webhookCreatedAt,
              })
            : {
                updateData: {},
                statusChanged: false,
                statusTimestampApplied: false,
              };
        let chargeUpdated = false;

        if (
          lockedCharge &&
          Object.keys(chargeUpdatePlan.updateData).length > 0
        ) {
          if (
            chargeUpdatePlan.statusTimestampApplied &&
            parsed.webhookCreatedAt
          ) {
            const guardedUpdate = await tx.billingCharge.updateMany({
              where: {
                id: lockedCharge.id,
                OR: [
                  {
                    gatewayStatusUpdatedAt: null,
                  },
                  {
                    gatewayStatusUpdatedAt: {
                      lte: parsed.webhookCreatedAt,
                    },
                  },
                ],
              },
              data: chargeUpdatePlan.updateData,
            });

            chargeUpdated = guardedUpdate.count > 0;
            staleEvent = staleEvent || !chargeUpdated;
          } else {
            await tx.billingCharge.update({
              where: {
                id: lockedCharge.id,
              },
              data: chargeUpdatePlan.updateData,
            });

            chargeUpdated = true;
          }
        }

        await tx.billingEventLog.update({
          where: {
            id: eventLogId,
          },
          data: {
            companyId: targets.companyId,
            chargeId: targets.charge?.id,
            customerId: targets.customer?.id,
            metadata: this.toJsonValue(
              this.mergeWebhookMetadata(latestEventLog.metadata, {
                asaasAccountId: parsed.asaasAccountId,
                asaasCustomerId: parsed.asaasCustomerId,
                externalReference: parsed.externalReference,
                gatewayChargeId: parsed.gatewayChargeId,
                matchedBy: targets.matchedBy,
                payloadHash: parsed.payloadHash,
                processingAttempts:
                  this.readMetadataNumber(
                    latestEventLog.metadata,
                    'processingAttempts',
                  ) + 1,
                lastProcessingAttemptAt: new Date().toISOString(),
                webhookCreatedAt:
                  parsed.webhookCreatedAt?.toISOString() ??
                  parsed.webhookCreatedAtRaw,
                staleEvent,
                staleComparedTo:
                  staleEvent && lockedCharge?.gatewayStatusUpdatedAt
                    ? lockedCharge.gatewayStatusUpdatedAt.toISOString()
                    : null,
                processingResult: staleEvent
                  ? 'ignored_stale_event'
                  : lockedCharge
                    ? chargeUpdated
                      ? 'charge_updated'
                      : Object.keys(chargeUpdatePlan.updateData).length > 0
                        ? 'charge_update_skipped'
                        : 'no_charge_changes'
                    : 'charge_not_found',
                lastProcessingError: null,
              }),
            ),
            processedAt: new Date(),
          },
        });

        return {
          processed: true,
          staleEvent,
          event: parsed.event,
          companyId: targets.companyId,
          matchedChargeId: lockedCharge?.id ?? null,
          eventLogId,
        };
      });
    } catch (error) {
      await this.markWebhookProcessingFailure(eventLogId, error);
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async retryPendingWebhookEvents() {
    const maxAgeSeconds = Number(
      this.configService.get<string>('BILLING_WEBHOOK_PENDING_AGE_SECONDS') ??
        '30',
    );
    const batchSize = Number(
      this.configService.get<string>('BILLING_WEBHOOK_RETRY_BATCH_SIZE') ??
        '20',
    );
    const cutoff = new Date(Date.now() - maxAgeSeconds * 1000);
    const pendingEvents = await this.prisma.billingEventLog.findMany({
      where: {
        source: BillingEventSource.WEBHOOK,
        processedAt: null,
        createdAt: {
          lte: cutoff,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
      },
      take: batchSize,
    });

    for (const eventLog of pendingEvents) {
      try {
        await this.processWebhookEventLog(eventLog.id);
      } catch (error) {
        this.logger.error(
          `Falha ao reprocessar webhook ${eventLog.id}.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  buildExternalReference(params: {
    companyId: string;
    studentId?: string | null;
    customerId?: string | null;
    ownerUserId?: string | null;
    timestamp?: Date;
  }) {
    const entityId =
      params.studentId ?? params.customerId ?? params.ownerUserId ?? 'manual';
    const timestamp = (params.timestamp ?? new Date())
      .toISOString()
      .replace(/[-:.]/g, '')
      .replace('T', '')
      .replace('Z', 'Z');

    return [
      this.sanitizeExternalReferencePart(params.companyId),
      this.sanitizeExternalReferencePart(entityId),
      timestamp,
    ].join('_');
  }

  private async persistIncomingWebhookEvent(params: {
    parsed: ParsedAsaasWebhook;
    security: SecurityValidationResult;
  }) {
    const mappedCompany =
      params.parsed.endpointCompanyId !== null
        ? { companyId: params.parsed.endpointCompanyId }
        : params.parsed.asaasAccountId === null
          ? null
          : await this.prisma.companyBillingSettings.findUnique({
              where: {
                asaasAccountId: params.parsed.asaasAccountId,
              },
              select: {
                companyId: true,
              },
            });

    try {
      const created = await this.prisma.billingEventLog.create({
        data: {
          companyId: mappedCompany?.companyId,
          eventType: params.parsed.event,
          source: BillingEventSource.WEBHOOK,
          gatewayEvent: params.parsed.event,
          deduplicationKey: params.parsed.deduplicationKey,
          ip: params.security.remoteIp,
          payload: this.toJsonValue(params.parsed.payload),
          metadata: this.toJsonValue({
            endpointCompanyId: params.parsed.endpointCompanyId,
            asaasAccountId: params.parsed.asaasAccountId,
            asaasCustomerId: params.parsed.asaasCustomerId,
            externalReference: params.parsed.externalReference,
            gatewayChargeId: params.parsed.gatewayChargeId,
            payloadHash: params.parsed.payloadHash,
            remoteIp: params.security.remoteIp,
            tokenValidated: params.security.tokenValidated,
            ipWhitelistApplied: params.security.ipWhitelistApplied,
            webhookCreatedAt:
              params.parsed.webhookCreatedAt?.toISOString() ??
              params.parsed.webhookCreatedAtRaw,
            processingAttempts: 0,
          }),
        },
        select: {
          id: true,
          companyId: true,
          chargeId: true,
          processedAt: true,
        },
      });

      return {
        ...created,
        created: true,
      };
    } catch (error) {
      if (!this.isUniqueConstraintError(error, 'deduplicationKey')) {
        throw error;
      }

      const existing = await this.prisma.billingEventLog.findUnique({
        where: {
          deduplicationKey: params.parsed.deduplicationKey,
        },
        select: {
          id: true,
          companyId: true,
          chargeId: true,
          processedAt: true,
        },
      });

      if (!existing) {
        throw error;
      }

      return {
        ...existing,
        created: false,
      };
    }
  }

  private async enqueueWebhookProcessing(eventLogId: string) {
    try {
      await this.queueService.addBillingWebhookJob(
        {
          eventLogId,
        },
        {
          jobId: `billing-webhook-${eventLogId}`,
        },
      );

      return true;
    } catch (error) {
      this.logger.error(
        `Nao foi possivel enfileirar o webhook ${eventLogId}. O cron de retry ficara como fallback.`,
        error instanceof Error ? error.stack : String(error),
      );

      return false;
    }
  }

  private async finalizeInvalidWebhookEvent(
    eventLogId: string,
    metadata: Prisma.JsonValue | null,
  ) {
    await this.prisma.billingEventLog.update({
      where: {
        id: eventLogId,
      },
      data: {
        metadata: this.toJsonValue(
          this.mergeWebhookMetadata(metadata, {
            processingAttempts:
              this.readMetadataNumber(metadata, 'processingAttempts') + 1,
            lastProcessingAttemptAt: new Date().toISOString(),
            lastProcessingError: 'invalid_payload',
            processingResult: 'ignored_invalid_payload',
          }),
        ),
        processedAt: new Date(),
      },
    });
  }

  private async markWebhookProcessingFailure(
    eventLogId: string,
    error: unknown,
  ) {
    const eventLog = await this.prisma.billingEventLog.findUnique({
      where: {
        id: eventLogId,
      },
      select: {
        metadata: true,
        processedAt: true,
      },
    });

    if (!eventLog || eventLog.processedAt) {
      return;
    }

    await this.prisma.billingEventLog.update({
      where: {
        id: eventLogId,
      },
      data: {
        metadata: this.toJsonValue(
          this.mergeWebhookMetadata(eventLog.metadata, {
            processingAttempts:
              this.readMetadataNumber(eventLog.metadata, 'processingAttempts') +
              1,
            lastProcessingAttemptAt: new Date().toISOString(),
            lastProcessingError: this.stringifyError(error),
            processingResult: 'processing_failed',
          }),
        ),
      },
    });
  }

  private parseAsaasWebhookPayload(
    payload: AsaasWebhookPayload,
    rawBody?: Buffer,
    endpointCompanyId: string | null = null,
  ): ParsedAsaasWebhook {
    const account = this.readObject(payload.account);
    const payment = this.readObject(payload.payment);
    const event = this.readString(payload.event) ?? 'UNKNOWN';
    const eventId = this.readString(payload.id);
    const webhookCreatedAtRaw =
      this.readString(payload.dateCreated) ??
      this.readString(payment?.dateCreated) ??
      this.readString(payment?.updatedAt);
    const payloadHash = this.buildPayloadHash(payload, rawBody);

    return {
      payload,
      account,
      payment,
      event,
      eventId,
      webhookCreatedAtRaw,
      webhookCreatedAt: this.parseGatewayDate(webhookCreatedAtRaw),
      asaasAccountId: this.readString(account?.id),
      gatewayChargeId: this.readString(payment?.id),
      externalReference: this.readString(payment?.externalReference),
      asaasCustomerId: this.readString(payment?.customer),
      endpointCompanyId,
      deduplicationKey: this.buildAsaasWebhookDeduplicationKey({
        endpointCompanyId,
        event,
        eventId,
        gatewayChargeId: this.readString(payment?.id),
        externalReference: this.readString(payment?.externalReference),
        webhookCreatedAt: webhookCreatedAtRaw,
        payloadHash,
      }),
      payloadHash,
    };
  }

  private assertAsaasWebhookSecurity(params: {
    headers?: RequestHeaders;
    remoteIp?: string | null;
  }): SecurityValidationResult {
    const headers = params.headers ?? {};
    const remoteIp = this.resolveRemoteIp(params.remoteIp);
    const tokenValidated = this.assertAsaasWebhookAccessToken(
      this.readHeaderValue(headers, 'asaas-access-token'),
    );
    const ipWhitelistApplied = this.assertAsaasWebhookIpWhitelist(remoteIp);

    return {
      remoteIp,
      tokenValidated,
      ipWhitelistApplied,
    };
  }

  // O Asaas autentica o webhook só pelo header "asaas-access-token" (não há
  // assinatura HMAC na documentação oficial). Sem token configurado, a rota
  // legada recusa tudo: antes ela aceitava qualquer requisição.
  private assertAsaasWebhookAccessToken(accessToken?: string | null) {
    const expectedToken = this.configService
      .get<string>('ASAAS_WEBHOOK_TOKEN')
      ?.trim();

    if (
      !expectedToken ||
      !accessToken ||
      !safeCompareStrings(accessToken, expectedToken)
    ) {
      throw new UnauthorizedException('Invalid Asaas webhook token');
    }

    return true;
  }

  private assertAsaasWebhookIpWhitelist(remoteIp: string | null) {
    const allowedIps = this.configService
      .get<string>('ASAAS_WEBHOOK_IP_WHITELIST')
      ?.split(',')
      .map((ip) => this.normalizeIp(ip))
      .filter(Boolean);

    if (!allowedIps?.length) {
      return false;
    }

    if (!remoteIp || !allowedIps.includes(remoteIp)) {
      throw new UnauthorizedException('Asaas webhook IP is not allowed');
    }

    return true;
  }

  private async resolveWebhookTargets(
    prisma: BillingDataClient,
    parsed: ParsedAsaasWebhook,
  ): Promise<ResolvedWebhookTargets> {
    if (parsed.endpointCompanyId) {
      return this.resolveCompanyScopedTargets(
        prisma,
        parsed,
        parsed.endpointCompanyId,
      );
    }

    const [mappedCompany, asaasCustomer] = await Promise.all([
      parsed.asaasAccountId
        ? prisma.companyBillingSettings.findUnique({
            where: {
              asaasAccountId: parsed.asaasAccountId,
            },
            select: {
              companyId: true,
            },
          })
        : Promise.resolve(null),
      parsed.asaasCustomerId
        ? prisma.billingCustomer.findUnique({
            where: {
              asaasCustomerId: parsed.asaasCustomerId,
            },
            select: {
              id: true,
              companyId: true,
            },
          })
        : Promise.resolve(null),
    ]);

    let charge = parsed.gatewayChargeId
      ? await prisma.billingCharge.findUnique({
          where: {
            gatewayChargeId: parsed.gatewayChargeId,
          },
          select: {
            id: true,
            companyId: true,
            customerId: true,
            gatewayChargeId: true,
            externalReference: true,
            gatewayStatus: true,
            gatewayInvoiceUrl: true,
            bankSlipUrl: true,
            status: true,
            paidAt: true,
            gatewayStatusUpdatedAt: true,
          },
        })
      : null;

    const companyIdForReferenceLookup =
      charge?.companyId ?? mappedCompany?.companyId ?? asaasCustomer?.companyId;

    if (!charge && parsed.externalReference && companyIdForReferenceLookup) {
      charge = await prisma.billingCharge.findUnique({
        where: {
          companyId_externalReference: {
            companyId: companyIdForReferenceLookup,
            externalReference: parsed.externalReference,
          },
        },
        select: {
          id: true,
          companyId: true,
          customerId: true,
          gatewayChargeId: true,
          externalReference: true,
          gatewayStatus: true,
          gatewayInvoiceUrl: true,
          bankSlipUrl: true,
          status: true,
          paidAt: true,
          gatewayStatusUpdatedAt: true,
        },
      });
    }

    const customer =
      asaasCustomer && (!charge || charge.companyId === asaasCustomer.companyId)
        ? asaasCustomer
        : null;
    const companyId =
      charge?.companyId ??
      customer?.companyId ??
      mappedCompany?.companyId ??
      null;

    return {
      companyId,
      matchedBy: charge
        ? parsed.gatewayChargeId &&
          charge.gatewayChargeId === parsed.gatewayChargeId
          ? 'gatewayChargeId'
          : 'externalReference'
        : null,
      charge,
      customer,
    };
  }

  /**
   * Webhook que chegou pela URL de uma empresa: cobrança e cliente só são
   * aceitos se forem dessa empresa. Um id do Asaas de outra empresa no
   * payload é tratado como "cobrança não encontrada".
   */
  private async resolveCompanyScopedTargets(
    prisma: BillingDataClient,
    parsed: ParsedAsaasWebhook,
    companyId: string,
  ): Promise<ResolvedWebhookTargets> {
    const [customer, chargeById] = await Promise.all([
      parsed.asaasCustomerId
        ? prisma.billingCustomer.findFirst({
            where: { companyId, asaasCustomerId: parsed.asaasCustomerId },
            select: { id: true, companyId: true },
          })
        : Promise.resolve(null),
      parsed.gatewayChargeId
        ? prisma.billingCharge.findFirst({
            where: { companyId, gatewayChargeId: parsed.gatewayChargeId },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    const chargeByReference =
      !chargeById && parsed.externalReference
        ? await prisma.billingCharge.findUnique({
            where: {
              companyId_externalReference: {
                companyId,
                externalReference: parsed.externalReference,
              },
            },
            select: { id: true },
          })
        : null;
    const chargeId = chargeById?.id ?? chargeByReference?.id ?? null;

    return {
      companyId,
      matchedBy: chargeById
        ? 'gatewayChargeId'
        : chargeByReference
          ? 'externalReference'
          : null,
      charge: chargeId ? await this.getChargeSnapshot(prisma, chargeId) : null,
      customer,
    };
  }

  private buildAsaasWebhookDeduplicationKey(params: {
    endpointCompanyId: string | null;
    event: string;
    eventId: string | null;
    gatewayChargeId: string | null;
    externalReference: string | null;
    webhookCreatedAt: string | null;
    payloadHash: string;
  }) {
    // Na rota por empresa a chave leva a empresa: um evento enviado com o
    // token de A nunca "ocupa" o id de um evento real de B.
    const prefix = params.endpointCompanyId
      ? `asaas:${params.endpointCompanyId}`
      : 'asaas';

    if (params.eventId) {
      return `${prefix}:event:${params.eventId}`;
    }

    const parts = [
      params.event,
      params.gatewayChargeId,
      params.externalReference,
      params.webhookCreatedAt,
    ].filter((value): value is string => !!value);

    if (parts.length > 0) {
      return `${prefix}:${parts.join(':')}`;
    }

    return `${prefix}:payload:${params.payloadHash}`;
  }

  private buildChargeUpdateFromAsaasWebhook(params: {
    charge: {
      customerId: string | null;
      gatewayChargeId: string | null;
      externalReference: string | null;
      gatewayStatus: string | null;
      gatewayInvoiceUrl: string | null;
      bankSlipUrl: string | null;
      status: BillingChargeStatus;
      paidAt: Date | null;
      gatewayStatusUpdatedAt: Date | null;
    };
    customerId?: string;
    payment: Record<string, unknown> | null;
    event: string;
    webhookCreatedAt: Date | null;
  }): ChargeUpdatePlan {
    const gatewayChargeId = this.readString(params.payment?.id);
    const externalReference = this.readString(
      params.payment?.externalReference,
    );
    const gatewayStatus = this.readString(params.payment?.status);
    const gatewayInvoiceUrl = this.readString(params.payment?.invoiceUrl);
    const bankSlipUrl = this.readString(params.payment?.bankSlipUrl);
    const nextStatus = this.resolveChargeStatusFromAsaasWebhook(
      params.event,
      gatewayStatus,
    );
    const nextPaidAt = this.resolvePaidAtFromAsaasWebhook(
      params.payment,
      nextStatus,
    );
    const updateData: Prisma.BillingChargeUpdateInput = {};
    const gatewayStatusChanged =
      !!gatewayStatus && params.charge.gatewayStatus !== gatewayStatus;
    const mappedStatusChanged =
      !!nextStatus && params.charge.status !== nextStatus;
    const statusChanged = gatewayStatusChanged || mappedStatusChanged;

    if (!params.charge.customerId && params.customerId) {
      updateData.customer = {
        connect: {
          id: params.customerId,
        },
      };
    }

    if (gatewayChargeId && params.charge.gatewayChargeId !== gatewayChargeId) {
      updateData.gatewayChargeId = gatewayChargeId;
    }

    if (
      externalReference &&
      params.charge.externalReference !== externalReference
    ) {
      updateData.externalReference = externalReference;
    }

    if (gatewayStatus && params.charge.gatewayStatus !== gatewayStatus) {
      updateData.gatewayStatus = gatewayStatus;
    }

    if (
      gatewayInvoiceUrl &&
      params.charge.gatewayInvoiceUrl !== gatewayInvoiceUrl
    ) {
      updateData.gatewayInvoiceUrl = gatewayInvoiceUrl;
    }

    if (bankSlipUrl && params.charge.bankSlipUrl !== bankSlipUrl) {
      updateData.bankSlipUrl = bankSlipUrl;
    }

    if (nextStatus && params.charge.status !== nextStatus) {
      updateData.status = nextStatus;
    }

    if (
      nextPaidAt &&
      (!params.charge.paidAt ||
        params.charge.paidAt.getTime() !== nextPaidAt.getTime())
    ) {
      updateData.paidAt = nextPaidAt;
    }

    if (statusChanged && params.webhookCreatedAt) {
      updateData.gatewayStatusUpdatedAt = params.webhookCreatedAt;
    }

    return {
      updateData,
      statusChanged,
      statusTimestampApplied:
        statusChanged && updateData.gatewayStatusUpdatedAt instanceof Date,
    };
  }

  private resolveChargeStatusFromAsaasWebhook(
    event: string,
    gatewayStatus: string | null,
  ) {
    const mappedFromEvent = this.mapAsaasEventToChargeStatus(event);
    if (mappedFromEvent) {
      return mappedFromEvent;
    }

    return this.mapAsaasPaymentStatusToChargeStatus(gatewayStatus);
  }

  /**
   * Evento do Asaas -> status do UniPass (nomes conferidos em
   * docs.asaas.com, "Eventos para cobranças"). null = o evento sozinho não
   * define o status e vale o payment.status do payload. É o caso de
   * "visualizou o boleto" e "alterou valor/vencimento": tratá-los como
   * ISSUED fazia um boleto já pago voltar a "emitido".
   */
  private mapAsaasEventToChargeStatus(event: string) {
    switch (event) {
      case 'PAYMENT_CREATED':
      case 'PAYMENT_RESTORED':
      case 'PAYMENT_RECEIVED_IN_CASH_UNDONE':
        return BillingChargeStatus.ISSUED;
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_DUNNING_RECEIVED':
        return BillingChargeStatus.PAID;
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_DUNNING_REQUESTED':
        return BillingChargeStatus.OVERDUE;
      case 'PAYMENT_DELETED':
      case 'PAYMENT_BANK_SLIP_CANCELLED':
        return BillingChargeStatus.CANCELLED;
      case 'PAYMENT_REFUNDED':
        return BillingChargeStatus.REFUNDED;
      case 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED':
      case 'PAYMENT_REPROVED_BY_RISK_ANALYSIS':
      case 'PAYMENT_REFUND_DENIED':
        return BillingChargeStatus.FAILED;
      default:
        // PAYMENT_UPDATED, PAYMENT_BANK_SLIP_VIEWED, PAYMENT_CHECKOUT_VIEWED,
        // PAYMENT_PARTIALLY_REFUNDED, PAYMENT_REFUND_IN_PROGRESS...
        return null;
    }
  }

  private mapAsaasPaymentStatusToChargeStatus(gatewayStatus: string | null) {
    switch (gatewayStatus) {
      case 'PENDING':
      case 'AWAITING_RISK_ANALYSIS':
      case 'AUTHORIZED':
        return BillingChargeStatus.ISSUED;
      case 'CONFIRMED':
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
      case 'DUNNING_RECEIVED':
        return BillingChargeStatus.PAID;
      case 'OVERDUE':
      case 'DUNNING_REQUESTED':
        return BillingChargeStatus.OVERDUE;
      case 'DELETED':
        return BillingChargeStatus.CANCELLED;
      case 'REFUNDED':
        return BillingChargeStatus.REFUNDED;
      default:
        return null;
    }
  }

  private resolvePaidAtFromAsaasWebhook(
    payment: Record<string, unknown> | null,
    nextStatus: BillingChargeStatus | null,
  ) {
    if (nextStatus !== BillingChargeStatus.PAID) {
      return null;
    }

    return (
      this.parseGatewayDate(this.readString(payment?.clientPaymentDate)) ??
      this.parseGatewayDate(this.readString(payment?.paymentDate)) ??
      this.parseGatewayDate(this.readString(payment?.confirmedDate))
    );
  }

  private isStaleWebhookEvent(params: {
    charge: { gatewayStatusUpdatedAt: Date | null } | null;
    webhookCreatedAt: Date | null;
  }) {
    if (!params.charge?.gatewayStatusUpdatedAt || !params.webhookCreatedAt) {
      return false;
    }

    return (
      params.charge.gatewayStatusUpdatedAt.getTime() >
      params.webhookCreatedAt.getTime()
    );
  }

  private buildPayloadHash(payload: AsaasWebhookPayload, rawBody?: Buffer) {
    const buffer = rawBody ?? Buffer.from(JSON.stringify(payload));
    return createHash('sha256').update(buffer).digest('hex');
  }

  private async acquireTransactionLock(
    prisma: BillingDataClient,
    namespace: number,
    resourceId: string,
  ) {
    // O Prisma manda número JS como bigint, e não existe
    // pg_advisory_xact_lock(bigint, integer): sem o ::int, todo webhook
    // falhava ao processar (só a versão de dois int4 aceita o hashtext).
    await prisma.$executeRaw`
      SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${resourceId}))
    `;
  }

  private async getChargeSnapshot(prisma: BillingDataClient, chargeId: string) {
    return prisma.billingCharge.findUnique({
      where: {
        id: chargeId,
      },
      select: {
        id: true,
        companyId: true,
        customerId: true,
        gatewayChargeId: true,
        externalReference: true,
        gatewayStatus: true,
        gatewayInvoiceUrl: true,
        bankSlipUrl: true,
        status: true,
        paidAt: true,
        gatewayStatusUpdatedAt: true,
      },
    });
  }

  // Só o IP que o Express viu (req.ip). Headers como x-real-ip e
  // x-forwarded-for vêm do próprio cliente e burlariam a allowlist; atrás de
  // um proxy confiável, o certo é configurar "trust proxy" no Express.
  private resolveRemoteIp(remoteIp?: string | null): string | null {
    return remoteIp ? this.normalizeIp(remoteIp) : null;
  }

  private normalizeIp(value: string) {
    const trimmed = value.trim();
    const withoutIpv6Prefix = trimmed.startsWith('::ffff:')
      ? trimmed.slice(7)
      : trimmed;

    if (
      withoutIpv6Prefix.includes(':') &&
      withoutIpv6Prefix.includes('.') &&
      withoutIpv6Prefix.split(':').length === 2
    ) {
      return withoutIpv6Prefix.split(':')[0];
    }

    return withoutIpv6Prefix;
  }

  private sanitizeExternalReferencePart(value: string) {
    const normalized = value.replace(/[^a-zA-Z0-9]/g, '');
    return normalized.length > 0 ? normalized : 'na';
  }

  private mergeWebhookMetadata(
    current: Prisma.JsonValue | null,
    patch: Record<string, unknown>,
  ) {
    const currentObject = this.readObject(current) ?? {};

    return {
      ...currentObject,
      ...patch,
    };
  }

  private readMetadataString(metadata: Prisma.JsonValue | null, key: string) {
    return this.readString(this.readObject(metadata)?.[key]);
  }

  private readMetadataNumber(metadata: Prisma.JsonValue | null, key: string) {
    const currentObject = this.readObject(metadata);
    const rawValue = currentObject?.[key];

    return typeof rawValue === 'number' && Number.isFinite(rawValue)
      ? rawValue
      : 0;
  }

  private stringifyError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private parseGatewayDate(value: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    const dateOnlyMatch = /^(?<date>\d{4}-\d{2}-\d{2})$/.exec(normalized);

    if (dateOnlyMatch?.groups?.date) {
      return this.parseIsoDateString(
        `${dateOnlyMatch.groups.date}T00:00:00.000Z`,
      );
    }

    const dateTimeMatch =
      /^(?<date>\d{4}-\d{2}-\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?(?<fraction>\.\d{1,3})?(?: ?(?<timezone>Z|[+\-]\d{2}:?\d{2}))?$/.exec(
        normalized,
      );

    if (!dateTimeMatch?.groups?.date) {
      return null;
    }

    const second = dateTimeMatch.groups.second ?? '00';
    const millisecond = this.normalizeFractionalSeconds(
      dateTimeMatch.groups.fraction,
    );
    const timezone = this.normalizeTimezoneOffset(
      dateTimeMatch.groups.timezone,
    );
    const isoValue =
      `${dateTimeMatch.groups.date}T${dateTimeMatch.groups.hour}:` +
      `${dateTimeMatch.groups.minute}:${second}${millisecond}${timezone}`;

    return this.parseIsoDateString(isoValue);
  }

  private parseIsoDateString(value: string) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private normalizeFractionalSeconds(value?: string) {
    if (!value) {
      return '.000';
    }

    const digits = value.slice(1).padEnd(3, '0').slice(0, 3);
    return `.${digits}`;
  }

  private normalizeTimezoneOffset(value?: string) {
    if (!value || value === 'Z') {
      return 'Z';
    }

    if (value.includes(':')) {
      return value;
    }

    return `${value.slice(0, 3)}:${value.slice(3, 5)}`;
  }

  private readObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private readString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private readHeaderValue(headers: RequestHeaders, headerName: string) {
    const normalizedHeaderName = headerName.toLowerCase();

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== normalizedHeaderName) {
        continue;
      }

      return Array.isArray(value) ? value[0] : value;
    }

    return undefined;
  }

  private isUniqueConstraintError(error: unknown, target: string) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      (error as { code?: string }).code !== 'P2002'
    ) {
      return false;
    }

    const meta =
      'meta' in error ? (error as { meta?: { target?: unknown } }).meta : null;
    const rawTarget = meta?.target;
    const targets = Array.isArray(rawTarget)
      ? rawTarget.map(String)
      : rawTarget
        ? [String(rawTarget)]
        : [];

    return targets.some((item) => item.includes(target));
  }

  private toJsonValue(value: unknown) {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
