import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingAuditOutcome,
  BillingBatchStatus,
  BillingChargeStatus,
  BillingGatewayMode,
  BillingTargetScope,
  Prisma,
} from '@prisma/client';
import {
  getAppTimeZone,
  getZonedDateParts,
} from '../notifications/notification-time.util';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import {
  BillingAuditAction,
  BillingAuditService,
} from './billing-audit.service';
import { refreshBillingBatch } from './billing-batch-progress';
import {
  buildChargeDescription,
  buildDueDate,
  getMonthRange,
  parseDateKey,
  toDateKey,
} from './billing-dates.util';
import { BillingGatewayService } from './billing-gateway.service';
import {
  BillingIssuanceService,
  BillingIssuer,
} from './billing-issuance.service';
import { requireBillingCompanyId } from './billing-settings.util';
import { BillingWebhookService } from './billing-webhook.service';
import {
  CreateBillingBatchDto,
  PreviewBillingBatchDto,
} from './dto/billing-batch.dto';

/** Situação de cada aluno na prévia do lote. */
export type BatchCandidateState =
  | 'READY'
  | 'MISSING_DOCUMENT'
  | 'ALREADY_CHARGED'
  | 'DUE_BEFORE_ISSUE';

const STATE_REASON: Record<Exclude<BatchCandidateState, 'READY'>, string> = {
  MISSING_DOCUMENT:
    'Responsável financeiro sem CPF/CNPJ (obrigatório para o Asaas).',
  ALREADY_CHARGED: 'Já existe uma cobrança deste grupo no mês.',
  DUE_BEFORE_ISSUE: 'O vencimento cai antes da data de emissão.',
};

const STUDENT_SCOPES: BillingTargetScope[] = [
  BillingTargetScope.STUDENTS,
  BillingTargetScope.STUDENTS_AND_COORDINATORS,
];

// Cobrança de lote parada (Redis fora do ar na criação, worker caiu) por
// mais que isso é reenfileirada pelo cron.
const STALLED_AFTER_MS = 2 * 60 * 1000;
const REQUEUE_BATCH_SIZE = 200;

const candidateSelect = {
  id: true,
  name: true,
  registration: true,
  user: { select: { id: true } },
  billingTemplate: {
    select: { id: true, name: true, amountCents: true, dueDay: true },
  },
  billingCustomers: {
    select: {
      id: true,
      name: true,
      email: true,
      documentMasked: true,
      documentEncrypted: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.StudentSelect;

/**
 * Emissão em massa. Prévia (cada aluno com a sua situação), confirmação dos
 * alunos marcados e o lote:
 * - gateway próprio: cria as cobranças e o lote termina na hora;
 * - Asaas: cria as cobranças como DRAFT e põe uma por job na fila
 *   "billing-issue"; o worker envia cada uma (BillingIssuanceService) e o
 *   progresso é recalculado a cada cobrança (billing-batch-progress.ts).
 */
@Injectable()
export class BillingBatchesService {
  private readonly logger = new Logger(BillingBatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly gateway: BillingGatewayService,
    private readonly issuance: BillingIssuanceService,
    private readonly audit: BillingAuditService,
    private readonly queue: QueueService,
    private readonly billingWebhookService: BillingWebhookService,
  ) {}

  async preview(
    companyId: string | null | undefined,
    dto: PreviewBillingBatchDto,
  ) {
    const normalizedCompanyId = requireBillingCompanyId(companyId);
    const mode = await this.gateway.getIssuingMode(normalizedCompanyId);
    const issueDate = this.resolveIssueDate(mode.gateway, dto.issueDate);
    const candidates = await this.loadCandidates(
      normalizedCompanyId,
      dto,
      mode.gateway,
      issueDate,
    );
    const ready = candidates.filter((item) => item.state === 'READY');

    return {
      gateway: mode.gateway,
      readyToIssue: mode.readyToIssue,
      pendingSteps: mode.pendingSteps,
      referenceMonth: dto.referenceMonth,
      issueDate: toDateKey(issueDate),
      items: candidates.map((item) => ({
        studentId: item.studentId,
        studentName: item.studentName,
        registration: item.registration,
        templateName: item.templateName,
        amountCents: item.amountCents,
        dueDate: item.dueDateKey,
        payerName: item.payer?.name ?? item.studentName,
        payerDocument: item.payer?.documentMasked ?? null,
        state: item.state,
        reason: item.state === 'READY' ? null : STATE_REASON[item.state],
      })),
      counts: {
        total: candidates.length,
        READY: ready.length,
        MISSING_DOCUMENT: this.countState(candidates, 'MISSING_DOCUMENT'),
        ALREADY_CHARGED: this.countState(candidates, 'ALREADY_CHARGED'),
        DUE_BEFORE_ISSUE: this.countState(candidates, 'DUE_BEFORE_ISSUE'),
      },
      readyAmountCents: ready.reduce((sum, item) => sum + item.amountCents, 0),
    };
  }

  async create(actor: BillingIssuer, dto: CreateBillingBatchDto) {
    const companyId = requireBillingCompanyId(actor.companyId);
    const mode = await this.gateway.getIssuingMode(companyId);
    const isAsaas = mode.gateway === BillingGatewayMode.ASAAS;

    if (isAsaas && !mode.readyToIssue) {
      throw new BadRequestException(
        `A integração com o Asaas não está pronta. Falta: ${mode.pendingSteps.join(' ')}`,
      );
    }

    const issueDate = this.resolveIssueDate(mode.gateway, dto.issueDate);
    const requestedIds = [...new Set(dto.studentIds)];
    const candidates = await this.loadCandidates(
      companyId,
      dto,
      mode.gateway,
      issueDate,
      requestedIds,
    );
    const byId = new Map(candidates.map((item) => [item.studentId, item]));
    const skipped: Array<{
      studentId: string | null;
      studentName: string | null;
      reason: string;
    }> = [];

    // Revalida no servidor: o que mudou desde a prévia (ou nunca foi desta
    // empresa) fica de fora, com o motivo — sem nomear dado de outra empresa.
    for (const studentId of requestedIds) {
      const candidate = byId.get(studentId);

      if (!candidate) {
        skipped.push({
          studentId: null,
          studentName: null,
          reason:
            'Aluno não encontrado, inativo ou sem grupo de boletos ativo.',
        });
      } else if (candidate.state !== 'READY') {
        skipped.push({
          studentId,
          studentName: candidate.studentName,
          reason: STATE_REASON[candidate.state],
        });
      }
    }

    const ready = candidates.filter((item) => item.state === 'READY');

    if (ready.length === 0) {
      throw new BadRequestException(
        skipped[0]?.reason ??
          'Nenhum aluno selecionado está pronto para emitir.',
      );
    }

    const batch = await this.prisma.billingBatch.create({
      data: {
        companyId,
        templateId: dto.templateId ?? null,
        referenceMonth: dto.referenceMonth,
        issueDate,
        gateway: mode.gateway,
        status: BillingBatchStatus.PROCESSING,
        createdByUserId: actor.id,
      },
      select: { id: true },
    });
    const now = new Date();
    const chargeIds: string[] = [];

    // Uma a uma: se outra emissão (individual) criar a mesma cobrança no
    // meio do caminho, o índice único barra só aquele aluno e o lote segue.
    for (const candidate of ready) {
      const payer =
        candidate.payer ??
        (await this.issuance.createDefaultPayer(
          companyId,
          candidate.studentId,
        ));

      try {
        const charge = await this.prisma.billingCharge.create({
          data: {
            companyId,
            batchId: batch.id,
            templateId: candidate.templateId,
            ownerUserId: candidate.userId,
            studentId: candidate.studentId,
            customerId: payer.id,
            recipientName: payer.name,
            recipientEmail: payer.email,
            recipientDocument: payer.documentMasked,
            description: buildChargeDescription(
              candidate.templateName,
              dto.referenceMonth,
            ),
            amountCents: candidate.amountCents,
            issueDate,
            dueDate: candidate.dueDate,
            status: isAsaas
              ? BillingChargeStatus.DRAFT
              : issueDate.getTime() > now.getTime()
                ? BillingChargeStatus.SCHEDULED
                : BillingChargeStatus.ISSUED,
            gateway: mode.gateway,
            referenceMonth: dto.referenceMonth,
            issuedByUserId: actor.id,
            externalReference:
              this.billingWebhookService.buildExternalReference({
                companyId,
                studentId: candidate.studentId,
                customerId: payer.id,
                ownerUserId: candidate.userId,
              }),
          },
          select: { id: true },
        });
        chargeIds.push(charge.id);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          skipped.push({
            studentId: candidate.studentId,
            studentName: candidate.studentName,
            reason: STATE_REASON.ALREADY_CHARGED,
          });
          continue;
        }
        throw error;
      }
    }

    await this.prisma.billingBatch.update({
      where: { id: batch.id },
      data: {
        skipped: skipped.length,
        skippedDetails: skipped as unknown as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      companyId,
      actorUserId: actor.id,
      ip: actor.ip,
      action: BillingAuditAction.BULK_BILLING_STARTED,
      outcome: BillingAuditOutcome.SUCCESS,
      metadata: {
        batchId: batch.id,
        gateway: mode.gateway,
        referenceMonth: dto.referenceMonth,
        charges: chargeIds.length,
        skipped: skipped.length,
      },
    });

    if (isAsaas) {
      await this.enqueue(chargeIds);
    }

    await refreshBillingBatch(this.prisma, this.audit, batch.id);
    return this.get(companyId, batch.id);
  }

  /**
   * Um job da fila: envia UMA cobrança do lote ao Asaas. Falha passageira
   * antes da última tentativa devolve "RETRY" (o worker relança e o BullMQ
   * tenta de novo); na última, a cobrança vira FAILED. Repetir o mesmo job
   * é seguro: a trava e a busca por externalReference do envio evitam
   * boleto em dobro, e o lote é recalculado, não incrementado.
   */
  async processCharge(chargeId: string, options: { finalAttempt: boolean }) {
    const charge = await this.prisma.billingCharge.findUnique({
      where: { id: chargeId },
      select: {
        id: true,
        companyId: true,
        status: true,
        gateway: true,
        batchId: true,
        batch: { select: { createdByUserId: true } },
      },
    });

    if (
      !charge ||
      charge.gateway !== BillingGatewayMode.ASAAS ||
      charge.status !== BillingChargeStatus.DRAFT
    ) {
      // Já resolvida (outra tentativa, reenvio manual, cancelamento).
      if (charge?.batchId) {
        await refreshBillingBatch(this.prisma, this.audit, charge.batchId);
      }
      return { outcome: 'DONE' as const };
    }

    const actor: BillingIssuer = {
      id: charge.batch?.createdByUserId ?? null,
      companyId: charge.companyId,
      ip: null,
    };
    let outcome: 'ISSUED' | 'FAILED' | 'RETRY' | 'DONE';

    try {
      const result = await this.issuance.sendToAsaas(
        actor,
        charge.companyId,
        chargeId,
        { retryableAs: options.finalAttempt ? 'FAILED' : 'DRAFT' },
      );
      outcome = result.outcome ?? 'DONE';
    } catch (error) {
      if (error instanceof ConflictException) {
        // Outra tentativa está enviando esta cobrança agora.
        outcome = options.finalAttempt ? 'DONE' : 'RETRY';
      } else if (error instanceof BadRequestException) {
        // Gateway deixou de estar pronto no meio do lote (chave removida,
        // trocou para gateway próprio): erro definitivo, com o motivo.
        await this.markFailed(chargeId, error.message);
        outcome = 'FAILED';
      } else if (options.finalAttempt) {
        this.logger.error(
          `Lote: falha inesperada ao enviar a cobrança ${chargeId}.`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.markFailed(
          chargeId,
          'Não foi possível concluir a emissão no Asaas. Abra a cobrança e use "Tentar de novo".',
        );
        outcome = 'FAILED';
      } else {
        throw error;
      }
    }

    if (charge.batchId) {
      await refreshBillingBatch(this.prisma, this.audit, charge.batchId);
    }

    return { outcome };
  }

  /**
   * Rede de segurança: cobrança de lote ainda DRAFT, sem envio em curso,
   * parada há mais de 2 min (Redis fora do ar ao criar o lote, worker que
   * caiu). O job tem id fixo por cobrança, então reenfileirar não duplica.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async requeueStalledBatchCharges() {
    const cutoff = new Date(Date.now() - STALLED_AFTER_MS);
    const stalled = await this.prisma.billingCharge.findMany({
      where: {
        status: BillingChargeStatus.DRAFT,
        gateway: BillingGatewayMode.ASAAS,
        batch: { is: { status: BillingBatchStatus.PROCESSING } },
        updatedAt: { lt: cutoff },
        OR: [
          { gatewaySyncStartedAt: null },
          { gatewaySyncStartedAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
      take: REQUEUE_BATCH_SIZE,
    });

    if (stalled.length > 0) {
      this.logger.warn(
        `${stalled.length} cobrança(s) de lote parada(s): reenfileirando.`,
      );
      await this.enqueue(stalled.map((charge) => charge.id));
    }

    return stalled.length;
  }

  async list(companyId: string | null | undefined, page = 1, limit = 10) {
    const normalizedCompanyId = requireBillingCompanyId(companyId);
    const where = { companyId: normalizedCompanyId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.billingBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { template: { select: { id: true, name: true } } },
      }),
      this.prisma.billingBatch.count({ where }),
    ]);

    return {
      data: data.map((batch) => this.mapBatch(batch)),
      total,
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Progresso + cada cobrança do lote (404 se o lote for de outra empresa). */
  async get(companyId: string | null | undefined, batchId: string) {
    const normalizedCompanyId = requireBillingCompanyId(companyId);
    const batch = await this.prisma.billingBatch.findFirst({
      where: { id: batchId, companyId: normalizedCompanyId },
      include: {
        template: { select: { id: true, name: true } },
        charges: {
          orderBy: { recipientName: 'asc' },
          select: {
            id: true,
            status: true,
            amountCents: true,
            dueDate: true,
            gatewayError: true,
            student: { select: { id: true, name: true, registration: true } },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Lote não encontrado.');
    }

    return {
      ...this.mapBatch(batch),
      skippedDetails: Array.isArray(batch.skippedDetails)
        ? batch.skippedDetails
        : [],
      items: batch.charges.map((charge) => ({
        chargeId: charge.id,
        status: charge.status,
        amountCents: charge.amountCents,
        dueDate: charge.dueDate,
        error: charge.gatewayError,
        student: charge.student,
      })),
    };
  }

  // ---------------------------------------------------------------- apoio

  private mapBatch(
    batch: Prisma.BillingBatchGetPayload<{
      include: { template: { select: { id: true; name: true } } };
    }>,
  ) {
    return {
      id: batch.id,
      status: batch.status,
      gateway: batch.gateway,
      referenceMonth: batch.referenceMonth,
      issueDate: batch.issueDate,
      template: batch.template,
      total: batch.total,
      succeeded: batch.succeeded,
      failed: batch.failed,
      pending: Math.max(0, batch.total - batch.succeeded - batch.failed),
      skipped: batch.skipped,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    };
  }

  private async loadCandidates(
    companyId: string,
    dto: PreviewBillingBatchDto,
    gateway: BillingGatewayMode,
    issueDate: Date,
    onlyStudentIds?: string[],
  ) {
    if (dto.templateId) {
      const template = await this.prisma.billingTemplate.findFirst({
        where: { id: dto.templateId, companyId },
        select: { active: true, targetScope: true, name: true },
      });

      if (!template) {
        throw new NotFoundException('Grupo de boletos não encontrado.');
      }

      if (!template.active || !STUDENT_SCOPES.includes(template.targetScope)) {
        throw new BadRequestException(
          `O grupo de boletos "${template.name}" está inativo ou não é de alunos.`,
        );
      }
    }

    const students = await this.prisma.student.findMany({
      where: {
        companyId,
        active: true,
        ...(onlyStudentIds ? { id: { in: onlyStudentIds } } : {}),
        billingTemplateId: dto.templateId ?? { not: null },
        billingTemplate: {
          is: { active: true, targetScope: { in: STUDENT_SCOPES } },
        },
      },
      select: candidateSelect,
      orderBy: { name: 'asc' },
    });

    const monthRange = getMonthRange(dto.referenceMonth);
    // Mesma regra da emissão individual: uma cobrança não cancelada por
    // aluno + grupo + mês (as antigas, sem referenceMonth, pelo vencimento).
    const existing = await this.prisma.billingCharge.findMany({
      where: {
        companyId,
        studentId: { in: students.map((student) => student.id) },
        status: { not: BillingChargeStatus.CANCELLED },
        OR: [
          { referenceMonth: dto.referenceMonth },
          {
            referenceMonth: null,
            dueDate: { gte: monthRange.start, lt: monthRange.endExclusive },
          },
        ],
      },
      select: { studentId: true, templateId: true },
    });
    const charged = new Set(
      existing.map((charge) => `${charge.studentId}:${charge.templateId}`),
    );
    const issueKey = toDateKey(issueDate);

    return students.flatMap((student) => {
      const template = student.billingTemplate;
      if (!template) return [];

      const dueDate = buildDueDate(dto.referenceMonth, template.dueDay);
      const payer = student.billingCustomers[0] ?? null;
      const state: BatchCandidateState = charged.has(
        `${student.id}:${template.id}`,
      )
        ? 'ALREADY_CHARGED'
        : toDateKey(dueDate) < issueKey
          ? 'DUE_BEFORE_ISSUE'
          : gateway === BillingGatewayMode.ASAAS && !payer?.documentEncrypted
            ? 'MISSING_DOCUMENT'
            : 'READY';

      return [
        {
          studentId: student.id,
          studentName: student.name,
          registration: student.registration,
          userId: student.user?.id ?? null,
          templateId: template.id,
          templateName: template.name,
          amountCents: template.amountCents,
          dueDate,
          dueDateKey: toDateKey(dueDate),
          payer,
          state,
        },
      ];
    });
  }

  // No Asaas a cobrança é criada na hora (decisão do produto); agendar
  // continua só no gateway próprio, como na emissão em lote de antes.
  private resolveIssueDate(gateway: BillingGatewayMode, issueDate?: string) {
    const today = parseDateKey(
      getZonedDateParts(
        new Date(),
        getAppTimeZone(this.configService.get<string>('APP_TIMEZONE')),
      ).dateKey,
    ) as Date;

    if (gateway === BillingGatewayMode.ASAAS || !issueDate) {
      return today;
    }

    const parsed = parseDateKey(issueDate);

    if (!parsed) {
      throw new BadRequestException('Informe uma data de emissão válida.');
    }

    return parsed;
  }

  private async enqueue(chargeIds: string[]) {
    for (const chargeId of chargeIds) {
      try {
        await this.queue.addBillingIssueJob({ chargeId });
      } catch (error) {
        // Sem Redis agora: o cron reenfileira em alguns minutos.
        this.logger.error(
          `Não foi possível enfileirar a cobrança ${chargeId}; o cron tenta de novo.`,
          error instanceof Error ? error.stack : String(error),
        );
        return;
      }
    }
  }

  private async markFailed(chargeId: string, message: string) {
    await this.prisma.billingCharge.updateMany({
      where: { id: chargeId, status: BillingChargeStatus.DRAFT },
      data: {
        status: BillingChargeStatus.FAILED,
        gatewayError: message,
        gatewaySyncStartedAt: null,
      },
    });
  }

  private countState(
    items: Array<{ state: BatchCandidateState }>,
    state: BatchCandidateState,
  ) {
    return items.filter((item) => item.state === state).length;
  }
}
