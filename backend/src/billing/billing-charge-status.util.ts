import { BillingChargeStatus, Prisma } from '@prisma/client';

/** Cobranças que já encerraram o ciclo: não contam como "em aberto". */
export const CLOSED_CHARGE_STATUSES: BillingChargeStatus[] = [
  BillingChargeStatus.PAID,
  BillingChargeStatus.CANCELLED,
];

/** Cobranças vivas, que ainda podem vencer. */
export const OPEN_CHARGE_STATUSES: BillingChargeStatus[] = [
  BillingChargeStatus.DRAFT,
  BillingChargeStatus.SCHEDULED,
  BillingChargeStatus.ISSUED,
  BillingChargeStatus.SENT,
];

export const OVERDUE_IGNORED_STATUSES: BillingChargeStatus[] = [
  BillingChargeStatus.PAID,
  BillingChargeStatus.CANCELLED,
  BillingChargeStatus.FAILED,
];

/**
 * Definição única de "cobrança vencida" da plataforma.
 *
 * Usada pela tela de boletos e pelo painel — as duas precisam mostrar o mesmo
 * número, então a regra mora aqui e não em cada serviço.
 */
export function buildOverdueChargeWhere(
  now: Date,
): Prisma.BillingChargeWhereInput {
  return {
    OR: [
      { status: BillingChargeStatus.OVERDUE },
      {
        dueDate: { lt: now },
        status: { in: OPEN_CHARGE_STATUSES },
      },
    ],
  };
}

/** Em aberto: tudo que não foi pago nem cancelado. */
export function buildOpenChargeWhere(): Prisma.BillingChargeWhereInput {
  return {
    status: { notIn: [...CLOSED_CHARGE_STATUSES] },
  };
}
