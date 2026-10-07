import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillingChargeStatus, Prisma, UserRole } from '@prisma/client';
import {
  CLOSED_CHARGE_STATUSES,
  OPEN_CHARGE_STATUSES,
  buildOverdueChargeWhere,
} from './billing-charge-status.util';
import { PrismaService } from '../prisma/prisma.service';
import { BillingWebhookService } from './billing-webhook.service';
import type { BillingChargeStatusFilter } from './dto/find-billing-charges.dto';
import { getMonthRange } from './billing-dates.util';
import {
  BillingAccessScope,
  billingChargeRelations,
  mapBillingCharge,
} from './billing-charge.mapper';
import { parseEncryptionKey } from './billing-crypto.util';
import {
  hashDocument,
  looksLikeDocument,
  onlyDigits,
} from './billing-document.util';
import {
  ensureCompanyBillingSettings,
  requireBillingCompanyId,
} from './billing-settings.util';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingWebhookService: BillingWebhookService,
    private readonly configService: ConfigService,
  ) {}

  async getOverview(params: {
    companyId?: string | null;
    userId: string;
    role: UserRole;
  }) {
    const companyId = requireBillingCompanyId(params.companyId);
    const settings = await ensureCompanyBillingSettings(this.prisma, companyId);
    const scope = this.getAccessScope(params.role);
    const chargesWhere = this.buildChargeAccessWhere({
      companyId,
      userId: params.userId,
      role: params.role,
    });
    const now = new Date();

    const [totalCharges, paidCharges, openCharges, overdueCharges, charges] =
      await Promise.all([
        this.prisma.billingCharge.count({
          where: chargesWhere,
        }),
        this.prisma.billingCharge.count({
          where: {
            AND: [chargesWhere, { status: BillingChargeStatus.PAID }],
          },
        }),
        this.prisma.billingCharge.count({
          where: {
            AND: [
              chargesWhere,
              {
                status: {
                  notIn: [...CLOSED_CHARGE_STATUSES],
                },
              },
            ],
          },
        }),
        this.prisma.billingCharge.count({
          where: {
            AND: [chargesWhere, this.buildOverdueChargeWhere(now)],
          },
        }),
        this.prisma.billingCharge.findMany({
          where: chargesWhere,
          include: billingChargeRelations,
          orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
        }),
      ]);

    return {
      accessScope: scope,
      permissions: {
        canManageGateway: params.role === UserRole.ADMIN,
        canViewCompanyOverview: scope === 'company',
        canViewOwnCharges: true,
      },
      // Só o modo; a situação detalhada do Asaas é GET /billing/gateway (ADMIN).
      gateway: settings.gatewayMode,
      summaryCards: this.buildSummaryCards({
        scope,
        totalCharges,
        paidCharges,
        openCharges,
        overdueCharges,
      }),
      charges: charges.map((charge) => mapBillingCharge(charge, now, scope)),
    };
  }

  async findCharges(params: {
    companyId?: string | null;
    userId: string;
    role: UserRole;
    page?: number;
    limit?: number;
    search?: string;
    templateId?: string;
    month?: string;
    status?: BillingChargeStatusFilter;
  }) {
    const companyId = requireBillingCompanyId(params.companyId);
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit =
      params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 10;
    const skip = (page - 1) * limit;
    const now = new Date();
    const filters: Prisma.BillingChargeWhereInput[] = [
      this.buildChargeAccessWhere({
        companyId,
        userId: params.userId,
        role: params.role,
      }),
    ];

    const normalizedSearch = params.search?.trim();
    const searchWhere = this.buildChargeSearchWhere(normalizedSearch);
    if (searchWhere) {
      filters.push(searchWhere);
    }

    if (params.templateId?.trim()) {
      filters.push({
        templateId: params.templateId.trim(),
      });
    }

    if (params.month?.trim()) {
      const monthRange = getMonthRange(params.month.trim());
      filters.push({
        dueDate: {
          gte: monthRange.start,
          lt: monthRange.endExclusive,
        },
      });
    }

    const statusWhere = this.buildChargeStatusWhere(params.status, now);
    if (statusWhere) {
      filters.push(statusWhere);
    }

    const where: Prisma.BillingChargeWhereInput =
      filters.length === 1
        ? filters[0]
        : {
            AND: filters,
          };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.billingCharge.findMany({
        where,
        skip,
        take: limit,
        include: billingChargeRelations,
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.billingCharge.count({ where }),
    ]);

    return {
      data: data.map((charge) =>
        mapBillingCharge(charge, now, this.getAccessScope(params.role)),
      ),
      total,
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async releaseScheduledCharges() {
    await this.prisma.billingCharge.updateMany({
      where: {
        status: BillingChargeStatus.SCHEDULED,
        issueDate: {
          lte: new Date(),
        },
      },
      data: {
        status: BillingChargeStatus.ISSUED,
      },
    });
  }

  private getAccessScope(role: UserRole): BillingAccessScope {
    if (role === UserRole.ADMIN) {
      return 'company';
    }

    return 'self';
  }

  private buildChargeAccessWhere(params: {
    companyId: string;
    userId: string;
    role: UserRole;
  }): Prisma.BillingChargeWhereInput {
    if (this.getAccessScope(params.role) === 'company') {
      return {
        companyId: params.companyId,
      };
    }

    return {
      companyId: params.companyId,
      ownerUserId: params.userId,
    };
  }

  private buildChargeSearchWhere(search?: string) {
    if (!search) {
      return null;
    }

    // CPF/CNPJ só por igualdade, pelo hash: o documento não fica em texto
    // puro no banco, então "contém" não existe para ele.
    const documentHash = this.hashSearchDocument(search);

    return {
      OR: [
        ...(documentHash ? [{ customer: { is: { documentHash } } }] : []),
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          recipientName: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          recipientEmail: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          externalReference: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          student: {
            is: {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  registration: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
        {
          customer: {
            is: {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
        {
          template: {
            is: {
              name: {
                contains: search,
                mode: 'insensitive',
              },
            },
          },
        },
      ],
    } satisfies Prisma.BillingChargeWhereInput;
  }

  private hashSearchDocument(search: string) {
    if (!looksLikeDocument(search)) {
      return null;
    }

    try {
      return hashDocument(
        onlyDigits(search),
        parseEncryptionKey(
          this.configService.get<string>('BILLING_ENCRYPTION_KEY'),
        ),
      );
    } catch {
      return null;
    }
  }

  private buildChargeStatusWhere(
    filter: BillingChargeStatusFilter | undefined,
    now: Date,
  ) {
    switch (filter) {
      case 'PAID':
        return {
          status: BillingChargeStatus.PAID,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'OPEN':
        return {
          status: {
            in: OPEN_CHARGE_STATUSES,
          },
          dueDate: {
            gte: now,
          },
        } satisfies Prisma.BillingChargeWhereInput;
      case 'OVERDUE':
        return this.buildOverdueChargeWhere(now);
      case 'SCHEDULED':
        return {
          status: BillingChargeStatus.SCHEDULED,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'ISSUED':
        return {
          status: BillingChargeStatus.ISSUED,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'SENT':
        return {
          status: BillingChargeStatus.SENT,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'DRAFT':
        return {
          status: BillingChargeStatus.DRAFT,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'CANCELLED':
        return {
          status: BillingChargeStatus.CANCELLED,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'FAILED':
        return {
          status: BillingChargeStatus.FAILED,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'REFUNDED':
        return {
          status: BillingChargeStatus.REFUNDED,
        } satisfies Prisma.BillingChargeWhereInput;
      case 'ALL':
      case undefined:
        return null;
      default:
        return null;
    }
  }

  private buildOverdueChargeWhere(now: Date) {
    return buildOverdueChargeWhere(now);
  }

  private buildSummaryCards(params: {
    scope: BillingAccessScope;
    totalCharges: number;
    paidCharges: number;
    openCharges: number;
    overdueCharges: number;
  }) {
    const totalLabel =
      params.scope === 'company' ? 'Boletos emitidos' : 'Meus boletos';
    const overdueLabel =
      params.scope === 'company' ? 'Inadimplentes' : 'Em atraso';
    const openLabel = params.scope === 'company' ? 'Em aberto' : 'Pendentes';

    return [
      {
        id: 'total',
        label: totalLabel,
        value: params.totalCharges,
        helper:
          params.scope === 'company'
            ? 'Visao consolidada da empresa.'
            : 'Cobrancas vinculadas ao seu usuario.',
      },
      {
        id: 'paid',
        label: 'Pagos',
        value: params.paidCharges,
        helper: 'Ja conciliados no historico.',
      },
      {
        id: 'overdue',
        label: overdueLabel,
        value: params.overdueCharges,
        helper: 'Boletos vencidos e ainda nao pagos.',
      },
      {
        id: 'open',
        label: openLabel,
        value: params.openCharges,
        helper: 'Cobrancas aguardando pagamento.',
      },
    ];
  }
}
