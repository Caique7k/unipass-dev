"use client";

import { useCallback, useEffect, useState } from "react";
import { Receipt, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/dashboard/components/page-kit";
import {
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
} from "@/app/dashboard/components/FormModal";
import api from "@/services/api";
import { getApiErrorMessage } from "../settings/hooks/useBillingGateway";
import type { BillingCharge, ChargeActionResult } from "../types/charge";
import { ChargeDetails } from "./ChargeDetails";

const NOT_CANCELLABLE = ["PAID", "REFUNDED", "CANCELLED"];

/**
 * Detalhe de uma cobrança da lista. Sempre recarrega da API ao abrir (o
 * webhook pode ter mudado o status). ADMIN cancela e reenvia ao Asaas.
 */
export function ChargeDetailModal({
  chargeId,
  canManage,
  onOpenChange,
  onChanged,
}: {
  chargeId: string | null;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [charge, setCharge] = useState<BillingCharge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async (id: string) => {
    setCharge(null);
    setError(null);
    try {
      const response = await api.get<BillingCharge>(`/billing/charges/${id}`);
      setCharge(response.data);
    } catch (loadError) {
      setError(
        getApiErrorMessage(loadError, "Não foi possível abrir a cobrança."),
      );
    }
  }, []);

  useEffect(() => {
    if (chargeId) void load(chargeId);
  }, [chargeId, load]);

  async function run(action: "cancel" | "retry") {
    if (!charge) return;
    setBusy(action);
    try {
      const response = await api.post<ChargeActionResult>(
        `/billing/charges/${charge.id}/${action}`,
      );
      setCharge(response.data.charge);
      onChanged();

      if (action === "cancel") {
        toast.success("Cobrança cancelada.");
        setConfirmCancel(false);
      } else if (response.data.outcome === "ISSUED") {
        toast.success("Cobrança criada no Asaas.");
      } else {
        toast.error(response.data.message ?? "O Asaas recusou de novo.");
      }
    } catch (actionError) {
      toast.error(
        getApiErrorMessage(
          actionError,
          action === "cancel"
            ? "Não foi possível cancelar a cobrança."
            : "Não foi possível reenviar ao Asaas.",
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  const canRetry =
    canManage &&
    charge?.gateway === "ASAAS" &&
    (charge.status === "FAILED" || charge.status === "DRAFT");
  const canCancel = canManage && !!charge && !NOT_CANCELLABLE.includes(charge.status);

  return (
    <FormModal
      open={!!chargeId}
      onOpenChange={onOpenChange}
      title="Cobrança"
      description={charge ? charge.description : undefined}
      icon={<Receipt size={18} />}
      size="md"
      footer={
        <>
          {canCancel && (
            <ModalCancelButton onClick={() => setConfirmCancel(true)} disabled={busy !== null}>
              Cancelar cobrança
            </ModalCancelButton>
          )}
          {canRetry && (
            <ModalSubmitButton onClick={() => void run("retry")} busy={busy === "retry"}>
              <RotateCcw size={14} />
              Tentar de novo
            </ModalSubmitButton>
          )}
          <ModalCancelButton onClick={() => onOpenChange(false)}>Fechar</ModalCancelButton>
        </>
      }
    >
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : charge ? (
        <ChargeDetails charge={charge} />
      ) : (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        onConfirm={() => void run("cancel")}
        title="Cancelar esta cobrança?"
        items={charge ? [`${charge.recipientName} — ${charge.description}`] : []}
        description={
          charge?.gateway === "ASAAS"
            ? "A cobrança é removida no Asaas e o boleto deixa de poder ser pago."
            : "A cobrança fica marcada como cancelada no UniPass."
        }
        consequence="Depois de cancelar, dá para emitir outra para o mesmo aluno e mês."
        confirmLabel="Cancelar cobrança"
        cancelLabel="Voltar"
        busy={busy === "cancel"}
      />
    </FormModal>
  );
}
