import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingAuditOutcome,
  BillingChargeStatus,
  BillingGatewayMode,
  BillingTargetScope,
  Prisma,
  UserRole,
} from '@prisma/client';
import {
  getAppTimeZone,
  getZonedDateParts,
} from '../notifications/notification-time.util';
import { PrismaService } from '../prisma/prisma.service';
import { AsaasApiError } from './asaas/asaas-api.error';
import { describeAsaasError } from './asaas/asaas-error.mapper';
import type { AsaasClient } from './asaas/asaas.client';
import type { AsaasEnvironment } from './asaas/asaas.config';
import {
  BillingAuditAction,
  BillingAuditService,
} from './billing-audit.service';
import { refreshBillingBatch } from './billing-batch-progress';
import {
  billingChargeRelations,
  mapBillingCharge,
} from './billing-charge.mapper';
import {
  BillingEncryptionKeyError,
  decryptSecret,
  parseEncryptionKey,
} from './billing-crypto.util';
import {
  buildChargeDescription,
  buildDueDate,
  getMonthRange,
  parseDateKey,
  toDateKey,
} from './billing-dates.util';
import { BillingGatewayService } from './billing-gateway.service';
import { requireBillingCompanyId } from './billing-settings.util';
import { BillingWebhookService } from './billing-webhook.service';
import { IssueSingleChargeDto } from './dto/issue-single-charge.dto';

export type BillingIssuer = {
  // null: ação do sistema (worker do lote cujo autor foi removido).
  id: string | null;
  companyId: string | null;
  ip?: string | null;
};

export type BillingReader = {
  companyId: string | null;
  userId: string;
  role: UserRole;
};

/** Resultado de emitir/reenviar: a cobrança como está agora no UniPass. */
/** RETRY: falha passageira no Asaas no lote; a fila do worker tenta de novo. */
export type IssueOutcome = 'ISSUED' | 'FAILED' | 'RETRY';

export type SendToAsaasOptions = {
  /**
   * O que fazer com falha passageira do Asaas (429, 5xx, timeout, rede).
   * FAILED (padrão, emissão individual): o admin vê e clica em "tentar de
   * novo". DRAFT (lote): a cobrança continua pendente e a fila repete.
   */
  retryableAs?: 'FAILED' | 'DRAFT';
};

const RETRYABLE_ASAAS_ERRORS = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
  'network',
]);

// Envio travado há mais que isso é considerado abandonado (processo caiu no
// meio): outra tentativa pode assumir.
const SYNC_LOCK_STALE_MS = 2 * 60 * 1000;
const STUDENT_SCOPES: BillingTargetScope[] = [
  BillingTargetScope.STUDENTS,
  BillingTargetScope.STUDENTS_AND_COORDINATORS,
];
const NOT_CANCELLABLE: BillingChargeStatus[] = [
  BillingChargeStatus.PAID,
  BillingChargeStatus.REFUNDED,
  BillingChargeStatus.CANCELLED,
];

const payerSelect = {
  id: true,
  name: true,
  email: true,
  documentEncrypted: true,
  documentMasked: true,
  asaasCustomerId: true,
  asaasSyncedAt: true,
} satisfies Prisma.BillingCustomerSelect;

type Payer = Prisma.BillingCustomerGetPayload<{ select: typeof payerSelect }>;

/**
 * Emissão de UMA cobrança por vez (o lote pelo Asaas é a próxima etapa).
 *
 * Gateway próprio: só cria a cobrança no UniPass, como sempre.
 * Asaas: cria a cobrança local primeiro (o índice único barra duplicata) e
 * depois envia ao Asaas — cliente (pagador) e cobrança BOLETO, linha
 * digitável e Pix. O Asaas não tem idempotência por header: a partir da 2ª
 * tentativa, a cobrança é procurada pelo externalReference antes de criar,
 * então um timeout seguido de "tentar de novo" não gera boleto em dobro.
 */
@Injectable()
export class BillingIssuanceService {
  private readonly logger = new Logger(BillingIssuanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gateway: BillingGatewayService,
    private readonly audit: BillingAuditService,
    private readonly billingWebhookService: BillingWebhookService,
  ) {}

  /** Tela de revisão: o que será emitido e tudo que impede a emissão. */
  async preview(
    companyId: string | null | undefined,
    dto: IssueSingleChargeDto,
  ) {
    const context = await this.buildContext(
      requireBillingCompanyId(companyId),
      dto,
    );

    return {
      student: context.student,
      template: { id: context.template.id, name: context.template.name },
      payer: context.payer
        ? {
            name: context.payer.name,
            email: context.payer.email,
            document: context.payer.documentMasked,
            hasDocument: !!context.payer.documentEncrypted,
          }
        : null,
      referenceMonth: dto.referenceMonth,
      amountCents: context.amountCents,
      dueDate: context.dueDateKey,
      description: context.description,
      gateway: context.mode.gateway,
      existingCharge: context.existingCharge,
      problems: context.problems,
      canIssue: context.problems.length === 0,
    };
  }

  async issue(actor: BillingIssuer, dto: IssueSingleChargeDto) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const context = await this.buildContext(companyId, dto);

    // Nada é criado, nem chamado no Asaas, enquanto houver o que corrigir.
    if (context.problems.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: context.problems.join(' '),
        problems: context.problems,
      });
    }

    const payer =
      context.payer ??
      (await this.createDefaultPayer(companyId, context.student.id));
    const isAsaas = context.mode.gateway === BillingGatewayMode.ASAAS;
    let chargeId: string;

    try {
      const charge = await this.prisma.billingCharge.create({
        data: {
          companyId,
          templateId: context.template.id,
          ownerUserId: context.student.userId,
          studentId: context.student.id,
          customerId: payer.id,
          recipientName: payer.name,
          recipientEmail: payer.email,
          recipientDocument: payer.documentMasked,
          description: context.description,
          amountCents: context.amountCents,
          issueDate: this.today(),
          dueDate: context.dueDate,
          status: isAsaas
            ? BillingChargeStatus.DRAFT
            : BillingChargeStatus.ISSUED,
          gateway: context.mode.gateway,
          referenceMonth: dto.referenceMonth,
          issuedByUserId: actor.id,
          externalReference: this.billingWebhookService.buildExternalReference({
            companyId,
            studentId: context.student.id,
            customerId: payer.id,
            ownerUserId: context.student.userId,
          }),
        },
        select: { id: true },
      });
      chargeId = charge.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Já existe uma cobrança para este aluno neste período. Abra a cobrança existente na lista de boletos.',
        );
      }
      throw error;
    }

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      chargeId,
      action: BillingAuditAction.BOLETO_CREATED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: {
        gateway: context.mode.gateway,
        referenceMonth: dto.referenceMonth,
        amountCents: context.amountCents,
      },
    });

    if (!isAsaas) {
      return this.result(companyId, chargeId, 'ISSUED');
    }

    return this.sendToAsaas(actor, companyId, chargeId);
  }

  /** "Tentar de novo" de uma cobrança Asaas que falhou (ou ficou no meio). */
  async retry(actor: BillingIssuer, chargeId: string) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const charge = await this.findChargeOrFail(companyId, chargeId);

    if (charge.gateway !== BillingGatewayMode.ASAAS) {
      throw new BadRequestException(
        'Esta cobrança é do gateway próprio: não há envio ao Asaas para repetir.',
      );
    }

    if (
      charge.status !== BillingChargeStatus.FAILED &&
      charge.status !== BillingChargeStatus.DRAFT
    ) {
      throw new BadRequestException(
        'Só cobranças que falharam ao enviar podem ser reenviadas.',
      );
    }

    const result = await this.sendToAsaas(actor, companyId, chargeId);
    await this.refreshBatchOf(charge.batchId);
    return result;
  }

  async cancel(actor: BillingIssuer, chargeId: string) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const charge = await this.findChargeOrFail(companyId, chargeId);

    if (charge.status === BillingChargeStatus.CANCELLED) {
      throw new BadRequestException('Esta cobrança já está cancelada.');
    }

    if (NOT_CANCELLABLE.includes(charge.status)) {
      throw new BadRequestException(
        'Cobrança paga ou estornada não pode ser cancelada pelo UniPass. Para devolver o dinheiro, faça o estorno no Asaas.',
      );
    }

    if (this.isSyncLocked(charge.gatewaySyncStartedAt)) {
      throw new ConflictException(
        'Esta cobrança está sendo enviada ao Asaas agora. Aguarde alguns segundos e tente cancelar de novo.',
      );
    }

    if (charge.gateway === BillingGatewayMode.ASAAS) {
      await this.removeFromAsaas(actor, companyId, charge);
    }

    await this.prisma.billingCharge.update({
      where: { id: charge.id },
      data: {
        status: BillingChargeStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledByUserId: actor.id,
      },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      chargeId: charge.id,
      action: BillingAuditAction.BOLETO_CANCELLED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: { gateway: charge.gateway, previousStatus: charge.status },
    });

    await this.refreshBatchOf(charge.batchId);
    return this.result(companyId, charge.id, null);
  }

  /** Detalhe de uma cobrança: ADMIN vê as da empresa; os outros, só as suas. */
  async getCharge(reader: BillingReader, chargeId: string) {
    const companyId = requireBillingCompanyId(reader.companyId);
    const isAdmin = reader.role === UserRole.ADMIN;
    const charge = await this.prisma.billingCharge.findFirst({
      where: {
        id: chargeId,
        companyId,
        ...(isAdmin ? {} : { ownerUserId: reader.userId }),
      },
      include: billingChargeRelations,
    });

    if (!charge) {
      throw new NotFoundException('Cobrança não encontrada.');
    }

    return mapBillingCharge(charge, new Date(), isAdmin ? 'company' : 'self');
  }

  // ---------------------------------------------------------------- Asaas

  async sendToAsaas(
    actor: BillingIssuer,
    companyId: string,
    chargeId: string,
    options: SendToAsaasOptions = {},
  ) {
    const { client, environment } =
      await this.gateway.getIssuingClient(companyId);
    const now = new Date();

    // Trava: só uma tentativa de envio por vez para a mesma cobrança.
    const locked = await this.prisma.billingCharge.updateMany({
      where: {
        id: chargeId,
        companyId,
        gateway: BillingGatewayMode.ASAAS,
        status: { in: [BillingChargeStatus.DRAFT, BillingChargeStatus.FAILED] },
        OR: [
          { gatewaySyncStartedAt: null },
          {
            gatewaySyncStartedAt: {
              lt: new Date(now.getTime() - SYNC_LOCK_STALE_MS),
            },
          },
        ],
      },
      data: { gatewaySyncStartedAt: now, gatewayAttempts: { increment: 1 } },
    });

    if (locked.count === 0) {
      const current = await this.findChargeOrFail(companyId, chargeId);

      if (
        current.status !== BillingChargeStatus.DRAFT &&
        current.status !== BillingChargeStatus.FAILED
      ) {
        // Outra tentativa já terminou: devolve o que está gravado.
        return this.result(companyId, chargeId, 'ISSUED');
      }

      throw new ConflictException(
        'Esta cobrança já está sendo enviada ao Asaas. Aguarde alguns segundos.',
      );
    }

    const charge = await this.prisma.billingCharge.findUniqueOrThrow({
      where: { id: chargeId },
      include: { customer: { select: payerSelect } },
    });
    let adopted = false;

    try {
      if (!charge.customer || !charge.externalReference) {
        throw new BadRequestException(
          'A cobrança está sem pagador. Cadastre o responsável financeiro no aluno e emita de novo.',
        );
      }

      const asaasCustomerId = await this.ensureAsaasCustomer(
        client,
        actor,
        companyId,
        charge.customer,
      );

      // A partir da 2ª tentativa, a anterior pode ter criado a cobrança e
      // caído antes de gravar a resposta (timeout): procura antes de criar.
      let payment =
        charge.gatewayAttempts > 1
          ? await client.findPaymentByExternalReference(
              charge.externalReference,
            )
          : null;
      adopted = !!payment;

      payment ??= await client.createPayment({
        customer: asaasCustomerId,
        value: charge.amountCents / 100,
        dueDate: toDateKey(charge.dueDate),
        description: charge.description.slice(0, 500),
        externalReference: charge.externalReference,
      });

      if (!payment.id) {
        throw new BadGatewayException(
          'O Asaas não devolveu o identificador da cobrança.',
        );
      }

      // Linha digitável e Pix são complementos: se falharem, a cobrança já
      // existe no Asaas e continua emitida (o link do boleto funciona).
      const identification = await client
        .getIdentificationField(payment.id)
        .catch((error: unknown) => {
          this.logFailure('identificationField', error);
          return null;
        });
      const pix = await client
        .getPixQrCode(payment.id)
        .catch((error: unknown) => {
          this.logFailure('pixQrCode', error);
          return null;
        });

      await this.prisma.billingCharge.update({
        where: { id: chargeId },
        data: {
          status: BillingChargeStatus.ISSUED,
          gatewayChargeId: payment.id,
          gatewayStatus: payment.status,
          gatewayStatusUpdatedAt: new Date(),
          bankSlipUrl: payment.bankSlipUrl,
          gatewayInvoiceUrl: payment.invoiceUrl,
          nossoNumero: identification?.nossoNumero ?? payment.nossoNumero,
          identificationField: identification?.identificationField ?? null,
          barCode: identification?.barCode ?? null,
          pixPayload: pix?.payload ?? null,
          pixExpiresAt: pix?.expirationDate
            ? new Date(pix.expirationDate)
            : null,
          gatewayError: null,
          gatewaySyncStartedAt: null,
        },
      });

      await this.audit.record({
        companyId,
        actorUserId: actor.id,
        ip: actor.ip,
        chargeId,
        action: BillingAuditAction.ASAAS_PAYMENT_CREATED,
        outcome: BillingAuditOutcome.SUCCESS,
        metadata: {
          gatewayChargeId: payment.id,
          adoptedExisting: adopted,
          attempt: charge.gatewayAttempts,
          pixAvailable: !!pix?.payload,
        },
      });

      return this.result(companyId, chargeId, 'ISSUED');
    } catch (error) {
      const message = this.failureMessage(error, environment);
      this.logFailure('sendToAsaas', error);

      const retryLater =
        options.retryableAs === 'DRAFT' &&
        error instanceof AsaasApiError &&
        RETRYABLE_ASAAS_ERRORS.has(error.kind);

      if (retryLater) {
        await this.prisma.billingCharge.update({
          where: { id: chargeId },
          data: {
            status: BillingChargeStatus.DRAFT,
            gatewayError: `Falha temporária no Asaas, nova tentativa automática em instantes. ${message}`,
            gatewaySyncStartedAt: null,
          },
        });

        return this.result(companyId, chargeId, 'RETRY', message);
      }

      await this.prisma.billingCharge.update({
        where: { id: chargeId },
        data: {
          status: BillingChargeStatus.FAILED,
          gatewayError: message,
          gatewaySyncStartedAt: null,
        },
      });

      await this.audit.record({
        companyId,
        actorUserId: actor.id,
        ip: actor.ip,
        chargeId,
        action: BillingAuditAction.BOLETO_ISSUE_FAILED,
        outcome: BillingAuditOutcome.FAILURE,
        metadata: {
          attempt: charge.gatewayAttempts,
          ...this.errorMetadata(error),
        },
      });

      return this.result(companyId, chargeId, 'FAILED', message);
    }
  }

  /** Garante o pagador no Asaas e devolve o id dele lá. */
  private async ensureAsaasCustomer(
    client: AsaasClient,
    actor: BillingIssuer,
    companyId: string,
    payer: Payer,
  ) {
    if (payer.asaasCustomerId && payer.asaasSyncedAt) {
      return payer.asaasCustomerId;
    }

    if (!payer.documentEncrypted) {
      throw new BadRequestException(
        'O responsável financeiro não tem CPF/CNPJ cadastrado. Cadastre no aluno e tente de novo.',
      );
    }

    const input = {
      name: payer.name,
      cpfCnpj: decryptSecret(payer.documentEncrypted, this.masterKey()),
      ...(payer.email ? { email: payer.email } : {}),
      // O id interno do pagador: permite reencontrar o cliente no Asaas.
      externalReference: payer.id,
    };
    let asaasCustomerId: string | null = null;

    if (payer.asaasCustomerId) {
      try {
        await client.updateCustomer(payer.asaasCustomerId, input);
        asaasCustomerId = payer.asaasCustomerId;
      } catch (error) {
        // Id antigo que não existe nesta conta (seed, outra chave): procura
        // de novo pelo externalReference abaixo.
        if (!(error instanceof AsaasApiError && error.kind === 'not_found')) {
          throw error;
        }
      }
    }

    if (!asaasCustomerId) {
      const found = await client.findCustomerByExternalReference(payer.id);

      if (found?.id && !found.deleted) {
        await client.updateCustomer(found.id, input);
        asaasCustomerId = found.id;
      } else {
        asaasCustomerId = (await client.createCustomer(input)).id;
      }
    }

    if (!asaasCustomerId) {
      throw new BadGatewayException(
        'O Asaas não devolveu o identificador do cliente.',
      );
    }

    await this.prisma.billingCustomer.update({
      where: { id: payer.id },
      data: { asaasCustomerId, asaasSyncedAt: new Date() },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.ASAAS_CUSTOMER_SYNCED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: { asaasCustomerId },
    });

    return asaasCustomerId;
  }

  private async removeFromAsaas(
    actor: BillingIssuer,
    companyId: string,
    charge: {
      id: string;
      gatewayChargeId: string | null;
      externalReference: string | null;
    },
  ) {
    const { client, environment } =
      await this.gateway.getIssuingClient(companyId);

    try {
      // Sem id gravado (envio que falhou no meio), ela ainda pode existir lá.
      const paymentId =
        charge.gatewayChargeId ??
        (charge.externalReference
          ? (
              await client.findPaymentByExternalReference(
                charge.externalReference,
              )
            )?.id
          : null);

      if (paymentId) {
        await client.deletePayment(paymentId);
      }
    } catch (error) {
      if (error instanceof AsaasApiError && error.kind === 'not_found') {
        return; // já não existe no Asaas
      }

      await this.audit.record({
        companyId,
        actorUserId: actor.id,
        ip: actor.ip,
        chargeId: charge.id,
        action: BillingAuditAction.BOLETO_CANCELLED,
        outcome: BillingAuditOutcome.FAILURE,
        metadata: this.errorMetadata(error),
      });

      throw new BadGatewayException(
        `Não foi possível cancelar no Asaas, então a cobrança continua ativa. ${describeAsaasError(error, environment)}`,
      );
    }
  }

  // -------------------------------------------------------------- contexto

  private async buildContext(companyId: string, dto: IssueSingleChargeDto) {
    const [student, template, mode] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: dto.studentId, companyId },
        select: {
          id: true,
          name: true,
          registration: true,
          active: true,
          user: { select: { id: true } },
          billingCustomers: {
            select: payerSelect,
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            take: 1,
          },
        },
      }),
      this.prisma.billingTemplate.findFirst({
        where: { id: dto.templateId, companyId },
        select: {
          id: true,
          name: true,
          active: true,
          amountCents: true,
          dueDay: true,
          targetScope: true,
        },
      }),
      this.gateway.getIssuingMode(companyId),
    ]);

    // Aluno ou grupo de outra empresa: "não existe" (404), como no resto.
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }

    if (!template) {
      throw new NotFoundException('Grupo de boletos não encontrado.');
    }

    const monthRange = getMonthRange(dto.referenceMonth);
    const dueDate = dto.dueDate
      ? parseDateKey(dto.dueDate)
      : buildDueDate(dto.referenceMonth, template.dueDay);
    const payer = student.billingCustomers[0] ?? null;
    const problems: string[] = [];

    if (!student.active) {
      problems.push(
        `${student.name} está inativo(a): reative o aluno para emitir.`,
      );
    }

    if (!template.active) {
      problems.push(`O grupo de boletos "${template.name}" está inativo.`);
    }

    if (!STUDENT_SCOPES.includes(template.targetScope)) {
      problems.push(`O grupo "${template.name}" não é de cobrança de alunos.`);
    }

    if (!dueDate) {
      problems.push('O vencimento informado não é uma data válida.');
    } else if (toDateKey(dueDate) < toDateKey(this.today())) {
      problems.push('O vencimento não pode ser uma data que já passou.');
    }

    if (mode.gateway === BillingGatewayMode.ASAAS) {
      if (!mode.readyToIssue) {
        problems.push(
          `A integração com o Asaas não está pronta. Falta: ${mode.pendingSteps.join(' ')}`,
        );
      }

      if (!payer?.documentEncrypted) {
        problems.push(
          `Não é possível emitir pelo Asaas para ${student.name}: o responsável financeiro não tem CPF/CNPJ cadastrado. Cadastre no aluno, na seção "Responsável financeiro".`,
        );
      }
    }

    // Mesma regra da emissão em lote: uma cobrança ativa por aluno + grupo
    // + mês. Cobranças antigas (sem referenceMonth) contam pelo vencimento.
    const existing = await this.prisma.billingCharge.findFirst({
      where: {
        companyId,
        studentId: student.id,
        templateId: template.id,
        status: { not: BillingChargeStatus.CANCELLED },
        OR: [
          { referenceMonth: dto.referenceMonth },
          {
            referenceMonth: null,
            dueDate: { gte: monthRange.start, lt: monthRange.endExclusive },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        dueDate: true,
        gateway: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      problems.push(
        'Já existe uma cobrança para este aluno neste período. Abra a cobrança existente em vez de emitir outra.',
      );
    }

    return {
      student: {
        id: student.id,
        name: student.name,
        registration: student.registration,
        userId: student.user?.id ?? null,
      },
      template,
      payer,
      mode,
      problems,
      existingCharge: existing,
      amountCents: dto.amountCents ?? template.amountCents,
      dueDate: dueDate as Date,
      dueDateKey: dueDate ? toDateKey(dueDate) : null,
      description:
        dto.description ||
        buildChargeDescription(template.name, dto.referenceMonth),
    };
  }

  // Sem pagador cadastrado (gateway próprio), o pagador padrão é o aluno —
  // o mesmo que a emissão em lote faz.
  async createDefaultPayer(companyId: string, studentId: string) {
    const student = await this.prisma.student.findFirstOrThrow({
      where: { id: studentId, companyId },
      select: { name: true, email: true, phone: true },
    });

    return this.prisma.billingCustomer.create({
      data: {
        companyId,
        studentId,
        name: student.name,
        email: student.email,
        phone: student.phone,
      },
      select: payerSelect,
    });
  }

  private async findChargeOrFail(companyId: string, chargeId: string) {
    const charge = await this.prisma.billingCharge.findFirst({
      where: { id: chargeId, companyId },
      select: {
        id: true,
        status: true,
        gateway: true,
        gatewayChargeId: true,
        externalReference: true,
        gatewaySyncStartedAt: true,
        batchId: true,
      },
    });

    if (!charge) {
      throw new NotFoundException('Cobrança não encontrada.');
    }

    return charge;
  }

  // Cobrança de lote reenviada ou cancelada à mão: o lote se recalcula.
  private async refreshBatchOf(batchId: string | null) {
    if (batchId) {
      await refreshBillingBatch(this.prisma, this.audit, batchId);
    }
  }

  private async result(
    companyId: string,
    chargeId: string,
    outcome: IssueOutcome | null,
    message?: string,
  ) {
    const charge = await this.prisma.billingCharge.findFirstOrThrow({
      where: { id: chargeId, companyId },
      include: billingChargeRelations,
    });

    return {
      outcome,
      message: message ?? null,
      charge: mapBillingCharge(charge, new Date(), 'company'),
    };
  }

  private isSyncLocked(startedAt: Date | null) {
    return !!startedAt && Date.now() - startedAt.getTime() < SYNC_LOCK_STALE_MS;
  }

  /** Hoje no fuso da aplicação, ao meio-dia UTC (padrão das datas). */
  private today() {
    const { dateKey } = getZonedDateParts(
      new Date(),
      getAppTimeZone(this.configService.get<string>('APP_TIMEZONE')),
    );
    return parseDateKey(dateKey) as Date;
  }

  private masterKey() {
    try {
      return parseEncryptionKey(
        this.configService.get<string>('BILLING_ENCRYPTION_KEY'),
      );
    } catch (error) {
      if (error instanceof BillingEncryptionKeyError) {
        throw new ServiceUnavailableException(
          'O servidor não está pronto para ler o CPF/CNPJ do pagador. Fale com o suporte do UniPass.',
        );
      }
      throw error;
    }
  }

  private failureMessage(error: unknown, environment: AsaasEnvironment) {
    if (error instanceof AsaasApiError) {
      return describeAsaasError(error, environment);
    }

    // Mensagens nossas (400/502/503 acima) já são para o usuário.
    if (
      error instanceof BadRequestException ||
      error instanceof BadGatewayException ||
      error instanceof ServiceUnavailableException
    ) {
      return error.message;
    }

    return 'Não foi possível concluir a emissão no Asaas. Tente de novo em alguns minutos.';
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

  private logFailure(step: string, error: unknown) {
    if (error instanceof AsaasApiError) {
      // O AsaasClient já registrou operação, status e códigos.
      return;
    }

    this.logger.error(
      `Emissão Asaas: falha em ${step}.`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
