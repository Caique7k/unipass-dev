import { Logger } from '@nestjs/common';
import {
  BillingAuditOutcome,
  BillingBatchStatus,
  BillingChargeStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  BillingAuditAction,
  BillingAuditService,
} from './billing-audit.service';

const logger = new Logger('BillingBatchProgress');

/**
 * Recalcula o andamento de um lote a partir das cobranças dele — nunca por
 * incremento. Job repetido, reenvio manual ou cancelamento no meio não
 * desalinham os números: o lote sempre reflete o que está no banco.
 *
 * DRAFT = ainda vai para o Asaas; FAILED = erro definitivo; o resto
 * (emitida, agendada, paga, cancelada depois...) conta como emitida.
 */
export async function refreshBillingBatch(
  prisma: PrismaService,
  audit: BillingAuditService,
  batchId: string,
) {
  const groups = await prisma.billingCharge.groupBy({
    by: ['status'],
    where: { batchId },
    _count: { _all: true },
  });
  const countOf = (status: BillingChargeStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  const pending = countOf(BillingChargeStatus.DRAFT);
  const failed = countOf(BillingChargeStatus.FAILED);
  const succeeded = total - pending - failed;
  const status =
    pending > 0
      ? BillingBatchStatus.PROCESSING
      : failed === 0
        ? BillingBatchStatus.COMPLETED
        : succeeded === 0
          ? BillingBatchStatus.FAILED
          : BillingBatchStatus.PARTIAL_FAILURE;

  const batch = await prisma.billingBatch.update({
    where: { id: batchId },
    data: { total, succeeded, failed, status },
    select: { companyId: true, createdByUserId: true },
  });

  if (pending > 0) {
    return { status, total, succeeded, failed, pending };
  }

  // Só a primeira vez que o lote termina registra a conclusão.
  const finished = await prisma.billingBatch.updateMany({
    where: { id: batchId, completedAt: null },
    data: { completedAt: new Date() },
  });

  if (finished.count === 1) {
    logger.log(
      `Lote ${batchId} terminou: ${succeeded} emitida(s), ${failed} com erro.`,
    );
    await audit.record({
      companyId: batch.companyId,
      actorUserId: batch.createdByUserId,
      action: BillingAuditAction.BULK_BILLING_COMPLETED,
      outcome:
        failed === 0
          ? BillingAuditOutcome.SUCCESS
          : BillingAuditOutcome.FAILURE,
      metadata: { batchId, total, succeeded, failed },
    });
  }

  return { status, total, succeeded, failed, pending };
}
