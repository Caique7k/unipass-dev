import { Prisma } from '@prisma/client';
import { OVERDUE_IGNORED_STATUSES } from './billing-charge-status.util';

export type BillingAccessScope = 'company' | 'self';

export const billingChargeRelations = {
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
      documentMasked: true,
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

export type BillingChargeWithRelations = Prisma.BillingChargeGetPayload<{
  include: typeof billingChargeRelations;
}>;

export function isChargeOverdue(
  charge: Pick<BillingChargeWithRelations, 'dueDate' | 'status'>,
  now: Date,
) {
  return (
    charge.dueDate.getTime() < now.getTime() &&
    !OVERDUE_IGNORED_STATUSES.includes(charge.status)
  );
}

/**
 * Cobrança como sai da API. O CPF/CNPJ do pagador é sempre mascarado; ids e
 * detalhes do gateway (cliente no Asaas, erro técnico já traduzido) só para
 * quem administra a empresa.
 */
export function mapBillingCharge(
  charge: BillingChargeWithRelations,
  now: Date,
  scope: BillingAccessScope,
) {
  const isCompanyScope = scope === 'company';

  return {
    id: charge.id,
    description: charge.description,
    amountCents: charge.amountCents,
    issueDate: charge.issueDate,
    dueDate: charge.dueDate,
    referenceMonth: charge.referenceMonth,
    status: charge.status,
    gateway: charge.gateway,
    gatewayStatus: charge.gatewayStatus,
    paidAt: charge.paidAt,
    cancelledAt: charge.cancelledAt,
    bankSlipUrl: charge.bankSlipUrl ?? charge.gatewayInvoiceUrl,
    gatewayInvoiceUrl: charge.gatewayInvoiceUrl,
    identificationField: charge.identificationField,
    barCode: charge.barCode,
    nossoNumero: charge.nossoNumero,
    pixPayload: charge.pixPayload,
    pixExpiresAt: charge.pixExpiresAt,
    externalReference: charge.externalReference,
    recipientName: charge.recipientName,
    recipientEmail: charge.recipientEmail,
    recipientDocument: charge.recipientDocument,
    isOverdue: isChargeOverdue(charge, now),
    student: charge.student,
    customer: charge.customer
      ? {
          id: charge.customer.id,
          name: charge.customer.name,
          email: charge.customer.email,
          document: charge.customer.documentMasked,
          ...(isCompanyScope
            ? { asaasCustomerId: charge.customer.asaasCustomerId }
            : {}),
        }
      : null,
    ...(isCompanyScope
      ? {
          gatewayChargeId: charge.gatewayChargeId,
          gatewayError: charge.gatewayError,
          gatewayAttempts: charge.gatewayAttempts,
        }
      : {}),
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

export type MappedBillingCharge = ReturnType<typeof mapBillingCharge>;
