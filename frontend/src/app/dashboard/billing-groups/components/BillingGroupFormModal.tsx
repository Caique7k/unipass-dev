"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import {
  FormField,
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "../../components/FormModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildApiUrl } from "@/services/api";
import {
  billingRecurrenceLabels,
  type BillingGroup,
  type BillingTemplateRecurrence,
} from "../types/billing-group";

const recurrenceOptions: BillingTemplateRecurrence[] = [
  "MONTHLY",
  "BIMONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "YEARLY",
];

function formatAmountToInput(amountCents?: number | null) {
  if (!amountCents) {
    return "";
  }

  return (amountCents / 100).toFixed(2);
}

function parseAmountToCents(value: string) {
  const normalized = value.replace(",", ".").trim();

  if (!normalized) {
    return undefined;
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }

  return Math.round(amount * 100);
}

export function BillingGroupFormModal({
  open,
  onOpenChange,
  billingGroup,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billingGroup?: BillingGroup | null;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [recurrence, setRecurrence] =
    useState<BillingTemplateRecurrence>("MONTHLY");
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = !!billingGroup?.id;

  useEffect(() => {
    setName(billingGroup?.name ?? "");
    setDescription(billingGroup?.description ?? "");
    setAmount(formatAmountToInput(billingGroup?.amountCents));
    setDueDay(billingGroup?.dueDay ? String(billingGroup.dueDay) : "");
    setRecurrence(billingGroup?.recurrence ?? "MONTHLY");
  }, [billingGroup, open]);

  async function handleSubmit() {
    const amountCents = parseAmountToCents(amount);
    const parsedDueDay = Number(dueDay);

    if (!name.trim()) {
      toast.error("Informe o nome do grupo de boletos.");
      return;
    }

    if (amountCents === undefined) {
      toast.error("Informe um valor valido em reais.");
      return;
    }

    if (
      !Number.isInteger(parsedDueDay) ||
      parsedDueDay < 1 ||
      parsedDueDay > 31
    ) {
      toast.error("Informe um dia de vencimento valido entre 1 e 31.");
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch(
        isEdit
          ? buildApiUrl(`/billing/templates/${billingGroup?.id}`)
          : buildApiUrl("/billing/templates"),
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            name,
            description,
            amountCents,
            dueDay: parsedDueDay,
            recurrence,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Erro ao salvar grupo de boletos");
      }

      toast.success(
        isEdit
          ? "Grupo de boletos atualizado com sucesso."
          : "Grupo de boletos criado com sucesso.",
      );

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Erro ao salvar grupo de boletos.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<FileText size={18} />}
      title={isEdit ? "Editar grupo de boletos" : "Novo grupo de boletos"}
      description="Valor, vencimento e recorrência que ficam amarrados aos alunos vinculados."
      footer={
        <>
          <ModalCancelButton onClick={() => onOpenChange(false)} />
          <ModalSubmitButton onClick={handleSubmit} busy={isSaving}>
            {isEdit ? "Salvar alterações" : "Criar grupo"}
          </ModalSubmitButton>
        </>
      }
    >
      <div className="space-y-5">
        <FormField label="Nome do grupo" required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Mensalidade transporte"
            autoComplete="off"
            className={fieldInputClass}
            style={fieldAccentStyle}
          />
        </FormField>

        <FormField
          label="Descrição"
          hint="Opcional. Ajuda a identificar a cobrança na listagem."
        >
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Observações para identificar a cobrança"
            rows={3}
            className={`${fieldInputClass} h-auto resize-y py-2.5 leading-relaxed`}
            style={fieldAccentStyle}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Valor" required hint="Em reais">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                R$
              </span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="425,00"
                inputMode="decimal"
                className={`${fieldInputClass} pl-9 tabular-nums`}
                style={fieldAccentStyle}
              />
            </div>
          </FormField>

          <FormField label="Vencimento" required hint="Dia do mês">
            <input
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              placeholder="10"
              type="number"
              min="1"
              max="31"
              className={`${fieldInputClass} tabular-nums`}
              style={fieldAccentStyle}
            />
          </FormField>

          <FormField label="Recorrência" required>
            <Select
              value={recurrence}
              onValueChange={(value) =>
                setRecurrence(value as BillingTemplateRecurrence)
              }
            >
              <SelectTrigger className="h-10 w-full cursor-pointer rounded-xl">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {recurrenceOptions.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    className="cursor-pointer"
                  >
                    {billingRecurrenceLabels[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </div>
    </FormModal>
  );
}
