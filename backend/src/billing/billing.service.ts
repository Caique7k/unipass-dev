import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingChargeStatus,
  BillingGatewayMode,
  BillingOnboardingStatus,
  BillingTargetScope,
  Prisma,
  UserRole,
} from '@prisma/client';
import {
  CLOSED_CHARGE_STATUSES,
  OPEN_CHARGE_STATUSES,
  OVERDUE_IGNORED_STATUSES,
  buildOverdueChargeWhere,
} from './billing-charge-status.util';
import { PrismaService } from '../prisma/prisma.service';
import { BillingWebhookService } from './billing-webhook.service';
import type { BillingChargeStatusFilter } from './dto/find-billing-charges.dto';
import { IssueBillingChargesDto } from './dto/issue-billing-charges.dto';
import { UpdateCompanyBillingSettingsDto } from './dto/update-company-billing-settings.dto';

type BillingAccessScope = 'company' | 'self';


const billingChargeRelations = {
  ownerUser: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  student: {
    select: {
      id: true,
      name: true,
      registration: true,
    },
  },
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      document: true,
      asaasCustomerId: true,
    },
  },
  template: {
    select: {
      id: true,
      name: true,
      recurrence: true,
    },
  },
} satisfies Prisma.BillingChargeInclude;

type BillingChargeWithRelations = Prisma.BillingChargeGetPayload<{
  include: typeof billingChargeRelations;
}>;

const studentBillingChargeSelect = {
  id: true,
  name: true,
  registration: true,
  email: true,
  phone: true,
  user: {
    select: {
      id: true,
    },
  },
  billingTemplate: {
    select: {
      id: true,
      name: true,
      amountCents: true,
      dueDay: true,
      recurrence: true,
      notifyOnGeneration: true,
      active: true,
    },
  },
  billingCustomers: {
    select: {
      id: true,
      name: true,
      email: true,
      document: true,
      phone: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.StudentSelect;

type StudentForBillingCharge = Prisma.StudentGetPayload<{
  select: typeof studentBillingChargeSelect;
}>;

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingWebhookService: BillingWebhookService,
  ) {}

  async getOverview(params: {
    companyId?: string | null;
    userId: string;
    role: UserRole;
  }) {
    const companyId = this.requireCompanyId(params.companyId);
    const settings = await this.ensureCompanySettings(companyId);
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
      settings: this.mapSettings(settings),
      tutorial: this.getTutorialContent(),
      onboardingChecklist: this.getOnboardingChecklist(settings),
      summaryCards: this.buildSummaryCards({
        scope,
        totalCharges,
        paidCharges,
        openCharges,
        overdueCharges,
      }),
      charges: charges.map((charge) => this.mapCharge(charge, now)),
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
    const companyId = this.requireCompanyId(params.companyId);
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
      const monthRange = this.getMonthRange(params.month.trim());
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
      data: data.map((charge) => this.mapCharge(charge, now)),
      total,
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async issueCharges(
    companyId: string | null | undefined,
    dto: IssueBillingChargesDto,
  ) {
    const normalizedCompanyId = this.requireCompanyId(companyId);
    const issueDate = this.parseDateKey(dto.issueDate);

    if (!issueDate) {
      throw new BadRequestException('Informe uma data de emissao valida.');
    }

    const monthRange = this.getMonthRange(dto.referenceMonth);
    const now = new Date();

    if (dto.templateId?.trim()) {
      const selectedTemplate = await this.prisma.billingTemplate.findFirst({
        where: {
          id: dto.templateId.trim(),
          companyId: normalizedCompanyId,
          active: true,
          targetScope: {
            in: [
              BillingTargetScope.STUDENTS,
              BillingTargetScope.STUDENTS_AND_COORDINATORS,
            ],
          },
        },
        select: {
          id: true,
        },
      });

      if (!selectedTemplate) {
        throw new BadRequestException(
          'Selecione um grupo de boletos ativo para a emissao.',
        );
      }
    }

    const students = await this.prisma.student.findMany({
      where: {
        companyId: normalizedCompanyId,
        active: true,
        ...(dto.templateId?.trim()
          ? {
              billingTemplateId: dto.templateId.trim(),
            }
          : {
              billingTemplateId: {
                not: null,
              },
            }),
        billingTemplate: {
          is: {
            active: true,
            targetScope: {
              in: [
                BillingTargetScope.STUDENTS,
                BillingTargetScope.STUDENTS_AND_COORDINATORS,
              ],
            },
          },
        },
      },
      select: studentBillingChargeSelect,
      orderBy: {
        name: 'asc',
      },
    });

    if (students.length === 0) {
      throw new BadRequestException(
        'Nenhum aluno ativo com grupo de boletos vinculado foi encontrado para esta emissao.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existingCharges = await tx.billingCharge.findMany({
        where: {
          companyId: normalizedCompanyId,
          studentId: {
            in: students.map((student) => student.id),
          },
          templateId: {
            in: students
              .map((student) => student.billingTemplate?.id)
              .filter((value): value is string => !!value),
          },
          dueDate: {
            gte: monthRange.start,
            lt: monthRange.endExclusive,
          },
          status: {
            not: BillingChargeStatus.CANCELLED,
          },
        },
        select: {
          studentId: true,
          templateId: true,
        },
      });

      const existingChargeKeys = new Set(
        existingCharges
          .filter(
            (charge): charge is { studentId: string; templateId: string } =>
              !!charge.studentId && !!charge.templateId,
          )
          .map((charge) => `${charge.studentId}:${charge.templateId}`),
      );

      const created: Array<{
        id: string;
        studentName: string;
        templateName: string;
        dueDate: Date;
        issueDate: Date;
        amountCents: number;
        status: BillingChargeStatus;
      }> = [];
      const skipped: Array<{
        studentId: string;
        studentName: string;
        templateName: string | null;
        reason: string;
      }> = [];

      for (const student of students) {
        const template = student.billingTemplate;

        if (!template?.active) {
          skipped.push({
            studentId: student.id,
            studentName: student.name,
            templateName: template?.name ?? null,
            reason: 'Grupo de boletos inativo ou indisponivel.',
          });
          continue;
        }

        const dueDate = this.buildDueDate(dto.referenceMonth, template.dueDay);

        if (issueDate.getTime() > dueDate.getTime()) {
          skipped.push({
            studentId: student.id,
            studentName: student.name,
            templateName: template.name,
            reason:
              'A data de emissao precisa ser igual ou anterior ao vencimento do grupo.',
          });
          continue;
        }

        const duplicateKey = `${student.id}:${template.id}`;
        if (existingChargeKeys.has(duplicateKey)) {
          skipped.push({
            studentId: student.id,
            studentName: student.name,
            templateName: template.name,
            reason:
              'Ja existe um boleto ativo para este aluno no mes de referencia.',
          });
          continue;
        }

        const customer = await this.ensureBillingCustomer(tx, {
          companyId: normalizedCompanyId,
          student,
        });
        const chargeStatus =
          issueDate.getTime() > now.getTime()
            ? BillingChargeStatus.SCHEDULED
            : BillingChargeStatus.ISSUED;

        const charge = await tx.billingCharge.create({
          data: {
            companyId: normalizedCompanyId,
            templateId: template.id,
            ownerUserId: student.user?.id ?? null,
            studentId: student.id,
            customerId: customer.id,
            recipientName: customer.name,
            recipientEmail: customer.email,
            recipientDocument: customer.document,
            description: this.buildChargeDescription(
              template.name,
              dto.referenceMonth,
            ),
            amountCents: template.amountCents,
            issueDate,
            dueDate,
            status: chargeStatus,
            externalReference:
              this.billingWebhookService.buildExternalReference({
                companyId: normalizedCompanyId,
                studentId: student.id,
                customerId: customer.id,
                ownerUserId: student.user?.id ?? null,
                timestamp: new Date(),
              }),
          },
        });

        existingChargeKeys.add(duplicateKey);
        created.push({
          id: charge.id,
          studentName: student.name,
          templateName: template.name,
          dueDate: charge.dueDate,
          issueDate: charge.issueDate,
          amountCents: charge.amountCents,
          status: charge.status,
        });
      }

      if (created.length === 0) {
        throw new BadRequestException(
          skipped[0]?.reason ??
            'Nenhum boleto pode ser emitido com os filtros informados.',
        );
      }

      return {
        referenceMonth: dto.referenceMonth,
        issueDate,
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
      };
    });
  }

  async updateCompanySettings(
    companyId: string | null | undefined,
    dto: UpdateCompanyBillingSettingsDto,
  ) {
    const normalizedCompanyId = this.requireCompanyId(companyId);
    const currentSettings =
      await this.ensureCompanySettings(normalizedCompanyId);
    const now = new Date();
    const nextGatewayMode =
      dto.usePlatformGateway === undefined
        ? undefined
        : dto.usePlatformGateway
          ? BillingGatewayMode.PLATFORM_GATEWAY
          : BillingGatewayMode.EXTERNAL;
    const nextOnboardingStatus =
      dto.usePlatformGateway === undefined
        ? undefined
        : this.resolveOnboardingStatusChange(
            currentSettings.onboardingStatus,
            dto.usePlatformGateway,
          );

    const updated = await this.prisma.companyBillingSettings.update({
      where: {
        companyId: normalizedCompanyId,
      },
      data: {
        gatewayMode: nextGatewayMode,
        onboardingStatus: nextOnboardingStatus,
        gatewayContactName: this.normalizeOptionalString(
          dto.gatewayContactName,
        ),
        gatewayContactEmail: this.normalizeOptionalString(
          dto.gatewayContactEmail,
        ),
        gatewayContactPhone: this.normalizeOptionalString(
          dto.gatewayContactPhone,
        ),
        legalEntityName: this.normalizeOptionalString(dto.legalEntityName),
        legalDocument: this.normalizeOptionalString(dto.legalDocument),
        bankInfoSummary: this.normalizeOptionalString(dto.bankInfoSummary),
        defaultAmountCents: dto.defaultAmountCents,
        defaultDueDay: dto.defaultDueDay,
        lgpdAcceptedAt:
          dto.lgpdAccepted === undefined
            ? undefined
            : dto.lgpdAccepted
              ? (currentSettings.lgpdAcceptedAt ?? now)
              : null,
        platformTermsAcceptedAt:
          dto.platformTermsAccepted === undefined
            ? undefined
            : dto.platformTermsAccepted
              ? (currentSettings.platformTermsAcceptedAt ?? now)
              : null,
      },
    });

    return this.mapSettings(updated);
  }

  async submitOnboarding(companyId: string | null | undefined) {
    const normalizedCompanyId = this.requireCompanyId(companyId);
    const settings = await this.ensureCompanySettings(normalizedCompanyId);

    if (settings.gatewayMode !== BillingGatewayMode.PLATFORM_GATEWAY) {
      throw new BadRequestException(
        'Ative o gateway da plataforma antes de enviar o onboarding.',
      );
    }

    const missingFields = [
      !settings.gatewayContactName && 'responsavel financeiro',
      !settings.gatewayContactEmail && 'e-mail financeiro',
      !settings.legalEntityName && 'razao social',
      !settings.legalDocument && 'documento da empresa',
      !settings.bankInfoSummary && 'resumo das informacoes bancarias',
      !settings.lgpdAcceptedAt && 'aceite de protecao de dados',
      !settings.platformTermsAcceptedAt && 'aceite dos termos da plataforma',
    ].filter(Boolean);

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Complete os seguintes campos antes de enviar: ${missingFields.join(', ')}.`,
      );
    }

    const updated = await this.prisma.companyBillingSettings.update({
      where: {
        companyId: normalizedCompanyId,
      },
      data: {
        onboardingStatus: BillingOnboardingStatus.UNDER_REVIEW,
        submittedAt: new Date(),
      },
    });

    return this.mapSettings(updated);
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

  private async ensureCompanySettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: {
        id: companyId,
      },
      select: {
        id: true,
      },
    });

    if (!company) {
      throw new BadRequestException(
        'Empresa nao encontrada para o modulo financeiro.',
      );
    }

    return this.prisma.companyBillingSettings.upsert({
      where: {
        companyId,
      },
      update: {},
      create: {
        companyId,
      },
    });
  }

  private requireCompanyId(companyId?: string | null) {
    if (!companyId) {
      throw new BadRequestException(
        'Este usuario nao esta vinculado a uma empresa.',
      );
    }

    return companyId;
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

    return {
      OR: [
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
                {
                  document: {
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

  private mapCharge(charge: BillingChargeWithRelations, now: Date) {
    return {
      id: charge.id,
      description: charge.description,
      amountCents: charge.amountCents,
      issueDate: charge.issueDate,
      dueDate: charge.dueDate,
      status: charge.status,
      gatewayStatus: charge.gatewayStatus,
      paidAt: charge.paidAt,
      bankSlipUrl: charge.bankSlipUrl ?? charge.gatewayInvoiceUrl,
      gatewayInvoiceUrl: charge.gatewayInvoiceUrl,
      externalReference: charge.externalReference,
      recipientName: charge.recipientName,
      recipientEmail: charge.recipientEmail,
      isOverdue: this.isChargeOverdue(charge, now),
      student: charge.student,
      customer: charge.customer,
      template: charge.template,
      ownerUser: charge.ownerUser
        ? {
            id: charge.ownerUser.id,
            name: charge.ownerUser.name,
            email: charge.ownerUser.email,
            role: charge.ownerUser.role,
          }
        : null,
    };
  }

  private isChargeOverdue(
    charge: Pick<BillingChargeWithRelations, 'dueDate' | 'status'>,
    now: Date,
  ) {
    return (
      charge.dueDate.getTime() < now.getTime() &&
      !OVERDUE_IGNORED_STATUSES.includes(charge.status)
    );
  }

  private async ensureBillingCustomer(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      student: StudentForBillingCharge;
    },
  ) {
    const existingCustomer = params.student.billingCustomers[0];

    if (existingCustomer) {
      return existingCustomer;
    }

    return tx.billingCustomer.create({
      data: {
        companyId: params.companyId,
        studentId: params.student.id,
        name: params.student.name,
        email: params.student.email ?? null,
        phone: params.student.phone ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        document: true,
        phone: true,
      },
    });
  }

  private buildChargeDescription(templateName: string, referenceMonth: string) {
    const match = /^(?<year>\d{4})-(?<month>\d{2})$/.exec(referenceMonth);

    if (!match?.groups) {
      return templateName;
    }

    return `${templateName} - ${match.groups.month}/${match.groups.year}`;
  }

  private buildDueDate(referenceMonth: string, dueDay: number) {
    const monthRange = this.getMonthRange(referenceMonth);
    const maxDay = new Date(
      Date.UTC(
        monthRange.start.getUTCFullYear(),
        monthRange.start.getUTCMonth() + 1,
        0,
        12,
        0,
        0,
      ),
    ).getUTCDate();
    const normalizedDueDay = Math.min(Math.max(dueDay, 1), maxDay);

    return new Date(
      Date.UTC(
        monthRange.start.getUTCFullYear(),
        monthRange.start.getUTCMonth(),
        normalizedDueDay,
        12,
        0,
        0,
      ),
    );
  }

  private parseDateKey(value: string) {
    const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);

    if (!match?.groups) {
      return null;
    }

    const year = Number(match.groups.year);
    const month = Number(match.groups.month);
    const day = Number(match.groups.day);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }

    const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  private getMonthRange(value: string) {
    const match = /^(?<year>\d{4})-(?<month>\d{2})$/.exec(value);

    if (!match?.groups) {
      throw new BadRequestException('Informe um mes de referencia valido.');
    }

    const year = Number(match.groups.year);
    const month = Number(match.groups.month);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new BadRequestException('Informe um mes de referencia valido.');
    }

    return {
      start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
      endExclusive: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
    };
  }

  private resolveOnboardingStatusChange(
    currentStatus: BillingOnboardingStatus,
    usePlatformGateway: boolean,
  ) {
    if (!usePlatformGateway) {
      if (
        currentStatus === BillingOnboardingStatus.ACTIVE ||
        currentStatus === BillingOnboardingStatus.UNDER_REVIEW
      ) {
        return BillingOnboardingStatus.SUSPENDED;
      }

      return BillingOnboardingStatus.NOT_STARTED;
    }

    if (
      currentStatus === BillingOnboardingStatus.ACTIVE ||
      currentStatus === BillingOnboardingStatus.UNDER_REVIEW
    ) {
      return currentStatus;
    }

    return BillingOnboardingStatus.IN_PROGRESS;
  }

  private normalizeOptionalString(value?: string) {
    if (value === undefined) {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private mapSettings(settings: {
    gatewayMode: BillingGatewayMode;
    onboardingStatus: BillingOnboardingStatus;
    gatewayContactName: string | null;
    gatewayContactEmail: string | null;
    gatewayContactPhone: string | null;
    legalEntityName: string | null;
    legalDocument: string | null;
    bankInfoSummary: string | null;
    defaultAmountCents: number | null;
    defaultDueDay: number | null;
    lgpdAcceptedAt: Date | null;
    platformTermsAcceptedAt: Date | null;
    submittedAt: Date | null;
    reviewedAt: Date | null;
    reviewNotes: string | null;
    asaasAccountId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      usePlatformGateway:
        settings.gatewayMode === BillingGatewayMode.PLATFORM_GATEWAY,
      gatewayMode: settings.gatewayMode,
      onboardingStatus: settings.onboardingStatus,
      gatewayContactName: settings.gatewayContactName,
      gatewayContactEmail: settings.gatewayContactEmail,
      gatewayContactPhone: settings.gatewayContactPhone,
      legalEntityName: settings.legalEntityName,
      legalDocument: settings.legalDocument,
      bankInfoSummary: settings.bankInfoSummary,
      defaultAmountCents: settings.defaultAmountCents,
      defaultDueDay: settings.defaultDueDay,
      lgpdAcceptedAt: settings.lgpdAcceptedAt,
      platformTermsAcceptedAt: settings.platformTermsAcceptedAt,
      submittedAt: settings.submittedAt,
      reviewedAt: settings.reviewedAt,
      reviewNotes: settings.reviewNotes,
      asaasAccountId: settings.asaasAccountId,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
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

  private getOnboardingChecklist(settings: {
    gatewayMode: BillingGatewayMode;
    gatewayContactName: string | null;
    gatewayContactEmail: string | null;
    legalEntityName: string | null;
    legalDocument: string | null;
    bankInfoSummary: string | null;
    lgpdAcceptedAt: Date | null;
    platformTermsAcceptedAt: Date | null;
  }) {
    return [
      {
        id: 'gateway',
        label: 'Gateway da plataforma ativado',
        done: settings.gatewayMode === BillingGatewayMode.PLATFORM_GATEWAY,
      },
      {
        id: 'contact',
        label: 'Contato financeiro cadastrado',
        done: !!settings.gatewayContactName && !!settings.gatewayContactEmail,
      },
      {
        id: 'legal',
        label: 'Razao social e documento preenchidos',
        done: !!settings.legalEntityName && !!settings.legalDocument,
      },
      {
        id: 'bank',
        label: 'Informacoes bancarias resumidas',
        done: !!settings.bankInfoSummary,
      },
      {
        id: 'lgpd',
        label: 'Aceite de protecao de dados',
        done: !!settings.lgpdAcceptedAt,
      },
      {
        id: 'terms',
        label: 'Aceite dos termos operacionais',
        done: !!settings.platformTermsAcceptedAt,
      },
    ];
  }

  private getTutorialContent() {
    return [
      {
        id: 'optional-module',
        title: 'Modulo opcional por empresa',
        description:
          'O UniPass nao obriga a empresa a usar o gateway da plataforma. Quem ja possui operacao propria pode continuar externo sem perder o restante do sistema.',
      },
      {
        id: 'financial-data',
        title: 'Dados financeiros e bancarios',
        description:
          'Ao ativar o gateway da plataforma, a empresa precisa informar responsavel financeiro, documento da empresa e dados bancarios para repasse e validacao operacional.',
      },
      {
        id: 'privacy',
        title: 'Protecao de dados e rastreabilidade',
        description:
          'Toda cobranca precisa ter trilha de auditoria, aceite de dados e uma politica clara de quem pode ver inadimplencia. No UniPass, apenas administradores veem a visao consolidada da empresa; os demais perfis ficam restritos as cobrancas proprias.',
      },
      {
        id: 'automation',
        title: 'Emissao pelos grupos vinculados',
        description:
          'Os boletos agora podem ser emitidos a partir dos grupos vinculados aos alunos, herdando valor e vencimento do template escolhido para cada cobranca.',
      },
    ];
  }
}
