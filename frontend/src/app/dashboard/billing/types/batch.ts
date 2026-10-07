import type { BillingGatewayMode } from "../settings/types/billing-gateway";
import type { BillingChargeStatus } from "./charge";

export type BatchCandidateState =
  | "READY"
  | "MISSING_DOCUMENT"
  | "ALREADY_CHARGED"
  | "DUE_BEFORE_ISSUE";

/** POST /billing/batches/preview. */
export type BatchPreview = {
  gateway: BillingGatewayMode;
  readyToIssue: boolean;
  pendingSteps: string[];
  referenceMonth: string;
  issueDate: string;
  items: Array<{
    studentId: string;
    studentName: string;
    registration: string;
    templateName: string;
    amountCents: number;
    dueDate: string;
    payerName: string;
    payerDocument: string | null;
    state: BatchCandidateState;
    reason: string | null;
  }>;
  counts: Record<BatchCandidateState, number> & { total: number };
  readyAmountCents: number;
};

export type BatchStatus =
  | "PROCESSING"
  | "COMPLETED"
  | "PARTIAL_FAILURE"
  | "FAILED";

export type BatchSummary = {
  id: string;
  status: BatchStatus;
  gateway: BillingGatewayMode;
  referenceMonth: string;
  issueDate: string;
  template: { id: string; name: string } | null;
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  skipped: number;
  createdAt: string;
  completedAt: string | null;
};

/** GET /billing/batches/:id e POST /billing/batches. */
export type BatchDetail = BatchSummary & {
  skippedDetails: Array<{
    studentId: string | null;
    studentName: string | null;
    reason: string;
  }>;
  items: Array<{
    chargeId: string;
    status: BillingChargeStatus;
    amountCents: number;
    dueDate: string;
    error: string | null;
    student: { id: string; name: string; registration: string } | null;
  }>;
};

export const batchStateLabels: Record<BatchCandidateState, string> = {
  READY: "Pronto",
  MISSING_DOCUMENT: "Sem CPF/CNPJ",
  ALREADY_CHARGED: "Já cobrado",
  DUE_BEFORE_ISSUE: "Vencimento antes da emissão",
};

export const batchStatusMeta: Record<
  BatchStatus,
  { label: string; tone: "info" | "success" | "warning" | "danger" }
> = {
  PROCESSING: { label: "Processando", tone: "info" },
  COMPLETED: { label: "Concluído", tone: "success" },
  PARTIAL_FAILURE: { label: "Concluído com erros", tone: "warning" },
  FAILED: { label: "Falhou", tone: "danger" },
};
