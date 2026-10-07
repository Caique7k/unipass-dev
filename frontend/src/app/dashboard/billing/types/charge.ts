import type { BillingTemplateRecurrence } from "@/app/dashboard/billing-groups/types/billing-group";
import type { UserRole } from "@/lib/permissions";
import type { BillingGatewayMode } from "../settings/types/billing-gateway";

export type BillingChargeStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "ISSUED"
  | "SENT"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED"
  | "FAILED"
  | "REFUNDED";

/** Cobrança como a API devolve (CPF/CNPJ do pagador sempre mascarado). */
export type BillingCharge = {
  id: string;
  description: string;
  amountCents: number;
  issueDate: string;
  dueDate: string;
  referenceMonth: string | null;
  status: BillingChargeStatus;
  gateway: BillingGatewayMode;
  gatewayStatus: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  bankSlipUrl: string | null;
  gatewayInvoiceUrl: string | null;
  identificationField: string | null;
  barCode: string | null;
  nossoNumero: string | null;
  pixPayload: string | null;
  pixExpiresAt: string | null;
  externalReference: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientDocument: string | null;
  isOverdue: boolean;
  // Só para o ADMIN.
  gatewayChargeId?: string | null;
  gatewayError?: string | null;
  gatewayAttempts?: number;
  student: {
    id: string;
    name: string;
    registration: string;
  } | null;
  customer: {
    id: string;
    name: string;
    email: string | null;
    document: string | null;
    asaasCustomerId?: string | null;
  } | null;
  template: {
    id: string;
    name: string;
    recurrence: BillingTemplateRecurrence;
  } | null;
  ownerUser: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  } | null;
};

/** POST /billing/charges, /retry e /cancel. */
export type ChargeActionResult = {
  outcome: "ISSUED" | "FAILED" | null;
  message: string | null;
  charge: BillingCharge;
};

/** POST /billing/charges/preview. */
export type ChargePreview = {
  student: { id: string; name: string; registration: string };
  template: { id: string; name: string };
  payer: {
    name: string;
    email: string | null;
    document: string | null;
    hasDocument: boolean;
  } | null;
  referenceMonth: string;
  amountCents: number;
  dueDate: string | null;
  description: string;
  gateway: BillingGatewayMode;
  existingCharge: {
    id: string;
    status: BillingChargeStatus;
    amountCents: number;
    dueDate: string;
    gateway: BillingGatewayMode;
  } | null;
  problems: string[];
  canIssue: boolean;
};

export const chargeStatusLabels: Record<BillingChargeStatus, string> = {
  DRAFT: "Rascunho",
  SCHEDULED: "Agendado",
  ISSUED: "Emitido",
  SENT: "Enviado",
  PAID: "Pago",
  OVERDUE: "Em atraso",
  CANCELLED: "Cancelado",
  FAILED: "Falhou",
  REFUNDED: "Estornado",
};

export const gatewayLabels: Record<BillingGatewayMode, string> = {
  EXTERNAL: "Próprio",
  ASAAS: "Asaas",
};

export function formatCurrency(amountCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
}

/** Datas de calendário vêm ao meio-dia UTC: formatar em UTC evita "voltar um dia". */
export function formatCalendarDate(value?: string | null) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
