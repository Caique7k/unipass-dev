"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { buildApiUrl } from "@/services/api";
import { Bus } from "../types/bus";
import {
  FormField,
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "../../components/FormModal";
import { ACCENT } from "../../components/primitives";

export function BusFormModal({
  open,
  setOpen,
  bus,
  onSuccess,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  bus?: Bus | null;
  onSuccess: () => void;
}) {
  const [plate, setPlate] = useState("");
  const [capacity, setCapacity] = useState(40);
  const [isSaving, setIsSaving] = useState(false);

  const isEdit = !!bus?.id;

  useEffect(() => {
    if (bus) {
      setPlate(bus.plate || "");
      setCapacity(bus.capacity || 40);
    } else {
      setPlate("");
      setCapacity(40);
    }
  }, [bus, open]);

  const handleSubmit = async () => {
    if (!plate.trim()) {
      toast.error("Informe a placa do ônibus.");
      return;
    }

    if (capacity < 1) {
      toast.error("A capacidade deve ser maior que zero.");
      return;
    }

    try {
      setIsSaving(true);

      const payload = { plate, capacity };

      const url = isEdit
        ? buildApiUrl(`/buses/${bus?.id}`)
        : buildApiUrl("/buses");

      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Erro ao salvar ônibus");
      }

      toast.success(
        isEdit ? "Ônibus atualizado com sucesso." : "Ônibus criado com sucesso.",
      );

      onSuccess();
      setOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar ônibus.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormModal
      open={open}
      onOpenChange={setOpen}
      title={isEdit ? "Editar ônibus" : "Novo ônibus"}
      description={
        isEdit
          ? "Atualize as informações operacionais deste veículo."
          : "Preencha os dados para cadastrar um novo veículo."
      }
      footer={
        <>
          <ModalCancelButton onClick={() => setOpen(false)} />
          <ModalSubmitButton onClick={handleSubmit} busy={isSaving}>
            {isEdit ? "Salvar alterações" : "Criar ônibus"}
          </ModalSubmitButton>
        </>
      }
    >
      <div className="space-y-5">
        <FormField
          label="Placa"
          required
          hint="A placa precisa ser única dentro da sua empresa."
        >
          <input
            value={plate}
            onChange={(event) => setPlate(event.target.value.toUpperCase())}
            placeholder="ABC1234"
            autoComplete="off"
            className={`${fieldInputClass} font-medium tracking-wider`}
            style={fieldAccentStyle}
          />
        </FormField>

        <FormField
          label="Capacidade"
          required
          hint="Total de assentos disponíveis no veículo."
        >
          <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 p-2">
            <CapacityButton
              onClick={() => setCapacity((value) => Math.max(1, value - 1))}
              disabled={capacity <= 1}
              label="Diminuir capacidade"
            >
              <Minus size={15} />
            </CapacityButton>

            <div className="text-center">
              <span className="block text-2xl font-semibold tabular-nums leading-none">
                {capacity}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                passageiros
              </span>
            </div>

            <CapacityButton
              onClick={() => setCapacity((value) => value + 1)}
              label="Aumentar capacidade"
            >
              <Plus size={15} />
            </CapacityButton>
          </div>
        </FormField>
      </div>
    </FormModal>
  );
}

function CapacityButton({
  children,
  onClick,
  disabled = false,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-border/60 transition hover:border-foreground/25 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: ACCENT }}
    >
      {children}
    </button>
  );
}
