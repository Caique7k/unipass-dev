import { Injectable, Logger } from '@nestjs/common';
import {
  BillingAuditOutcome,
  BillingEventSource,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Ações financeiras auditadas (BillingEventLog.eventType, source MANUAL). */
export const BillingAuditAction = {
  GATEWAY_CHANGED: 'BILLING_GATEWAY_CHANGED',
  ASAAS_CREDENTIALS_UPDATED: 'ASAAS_CREDENTIALS_UPDATED',
  ASAAS_CREDENTIALS_REMOVED: 'ASAAS_CREDENTIALS_REMOVED',
  ASAAS_CONNECTION_TESTED: 'ASAAS_CONNECTION_TESTED',
  ASAAS_WEBHOOK_CONFIGURED: 'ASAAS_WEBHOOK_CONFIGURED',
} as const;

export type BillingAuditActionName =
  (typeof BillingAuditAction)[keyof typeof BillingAuditAction];

// Nome de campo que nunca entra na auditoria, em qualquer nível do metadata.
const SENSITIVE_KEY =
  /(api_?key|access_?token|auth_?token|token|secret|password|senha|cpf|cnpj|document)/i;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditMetadata);
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, item]) => [key, sanitizeAuditMetadata(item)]),
    );
  }

  return value;
}

export type BillingAuditEntry = {
  companyId: string;
  actorUserId: string | null;
  action: BillingAuditActionName;
  outcome: BillingAuditOutcome;
  ip?: string | null;
  chargeId?: string | null;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class BillingAuditService {
  private readonly logger = new Logger(BillingAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra a ação. Falhar ao auditar não desfaz a ação já feita (ela já
   * aconteceu no Asaas, por exemplo) — fica no log do servidor.
   */
  async record(entry: BillingAuditEntry) {
    try {
      await this.prisma.billingEventLog.create({
        data: {
          companyId: entry.companyId,
          actorUserId: entry.actorUserId,
          chargeId: entry.chargeId ?? null,
          eventType: entry.action,
          source: BillingEventSource.MANUAL,
          outcome: entry.outcome,
          ip: entry.ip ?? null,
          metadata: entry.metadata
            ? (sanitizeAuditMetadata(entry.metadata) as Prisma.InputJsonValue)
            : undefined,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Falha ao registrar auditoria ${entry.action}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
