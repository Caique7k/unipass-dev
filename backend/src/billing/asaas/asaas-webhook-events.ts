/**
 * Eventos de cobrança que o webhook do UniPass assina no Asaas. Nomes
 * conferidos em docs.asaas.com ("Eventos para cobranças"). Eventos só de
 * cartão (chargeback, captura, análise de risco) e de split ficam de fora:
 * o UniPass emite boleto + Pix.
 */
export const ASAAS_PAYMENT_WEBHOOK_EVENTS = [
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_ANTICIPATED',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_RESTORED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_DUNNING_REQUESTED',
  'PAYMENT_DUNNING_RECEIVED',
  'PAYMENT_BANK_SLIP_CANCELLED',
  'PAYMENT_BANK_SLIP_VIEWED',
  'PAYMENT_CHECKOUT_VIEWED',
] as const;

export const ASAAS_WEBHOOK_PATH = '/billing/webhook/asaas';
