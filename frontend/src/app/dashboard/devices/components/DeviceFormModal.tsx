"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Check, ChevronsUpDown, SmartphoneNfc } from "lucide-react";
import {
  FormField,
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
  fieldAccentStyle,
  fieldInputClass,
} from "../../components/FormModal";

import { cn } from "@/lib/utils";
import api from "@/services/api";
import { toast } from "sonner";

type Device = {
  id?: string;
  busId?: string | null;
  code?: string | null;
  secret?: string | null;
  hardwareId?: string;
  active?: boolean;
};

type Bus = {
  id: string;
  plate: string;
};

export function DeviceModal({
  open,
  onOpenChange,
  device,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: Device | null;
  onSuccess: () => void;
}) {
  const [pairingCode, setPairingCode] = useState("");
  const [busId, setBusId] = useState("");
  const [busSearch, setBusSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingBuses, setLoadingBuses] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [busDropdownOpen, setBusDropdownOpen] = useState(false);
  const [buses, setBuses] = useState<Bus[]>([]);

  const isEditing = !!device?.id;

  useEffect(() => {
    if (!open) return;

    async function fetchBuses() {
      try {
        setLoadingBuses(true);
        const res = await api.get("/buses", {
          params: {
            page: 1,
            limit: 100,
          },
        });

        setBuses(res.data.data ?? []);
      } catch (err) {
        console.error("Erro ao buscar ônibus:", err);
        setBuses([]);
        toast.error("Não foi possível carregar os ônibus.");
      } finally {
        setLoadingBuses(false);
      }
    }

    fetchBuses();
  }, [open]);

  useEffect(() => {
    setPairingCode("");
    setBusSearch("");
    setErrorMessage("");
    setBusDropdownOpen(false);
    setBusId(device?.busId ?? "");
  }, [device, open]);

  const filteredBuses = useMemo(() => {
    const search = busSearch.trim().toLowerCase();

    if (!search) return buses;

    return buses.filter((bus) => bus.plate.toLowerCase().includes(search));
  }, [busSearch, buses]);

  const selectedBus = buses.find((bus) => bus.id === busId);
  const hasBuses = buses.length > 0;

  const handleSubmit = async () => {
    if (loading) return;

    if (!isEditing && !pairingCode.trim()) {
      const message = "Informe o código temporário exibido no IoT.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    if (!busId) {
      const message = "Selecione um ônibus para vincular ao dispositivo.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");

      if (isEditing) {
        await api.patch(`/devices/${device.id}/bus`, {
          busId,
        });
        toast.success("Ônibus alterado com sucesso.");
      } else {
        await api.post("/devices/link", {
          pairingCode,
          busId,
        });
        toast.success("UniHub pareado com sucesso.");
      }

      onOpenChange(false);
      onSuccess();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const backendMessage =
          typeof err.response?.data?.message === "string"
            ? err.response.data.message
            : Array.isArray(err.response?.data?.message)
              ? err.response?.data.message.join(", ")
              : err.message;

        setErrorMessage(backendMessage || "Não foi possível salvar o dispositivo.");
        toast.error(backendMessage || "Não foi possível salvar o UniHub.");
        console.error("Erro ao salvar device:", {
          status: err.response?.status,
          data: err.response?.data,
          message: err.message,
        });
      } else {
        setErrorMessage("Não foi possível salvar o dispositivo.");
        toast.error("Não foi possível salvar o UniHub.");
        console.error("Erro ao salvar device:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      icon={<SmartphoneNfc size={18} />}
      title={isEditing ? "Trocar ônibus do UniHub" : "Parear dispositivo"}
      description={
        isEditing
          ? "Troque o ônibus associado sem alterar o dispositivo."
          : "Use o código temporário exibido na tela do UniHub para concluir o pareamento."
      }
      footer={
        <>
          <ModalCancelButton onClick={() => onOpenChange(false)} />
          <ModalSubmitButton
            onClick={handleSubmit}
            busy={loading}
            disabled={loadingBuses || !hasBuses}
          >
            {isEditing ? "Salvar ônibus" : "Parear dispositivo"}
          </ModalSubmitButton>
        </>
      }
    >
      <div className="space-y-5">
        {!isEditing && (
          <FormField
            label="Código temporário"
            required
            hint="Os 6 caracteres que aparecem na tela do dispositivo. Vale por 10 minutos."
          >
            <input
              placeholder="Ex.: A1B2C3"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
              autoComplete="off"
              className={`${fieldInputClass} font-mono tracking-[0.3em]`}
              style={fieldAccentStyle}
            />
          </FormField>
        )}

        <FormField
          label="Ônibus"
          required
          error={
            !hasBuses && !loadingBuses
              ? "Cadastre um ônibus primeiro para vincular este dispositivo."
              : undefined
          }
          hint={
            hasBuses ? "O dispositivo passa a registrar embarques nesse veículo." : undefined
          }
        >
          <div className="relative">
            <button
              type="button"
              disabled={!hasBuses || loadingBuses}
              onClick={() => setBusDropdownOpen((prev) => !prev)}
              className={`${fieldInputClass} flex cursor-pointer items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-50`}
              style={fieldAccentStyle}
            >
              <span className="truncate">
                {loadingBuses
                  ? "Carregando ônibus..."
                  : selectedBus?.plate || "Selecione um ônibus"}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
            </button>

            {busDropdownOpen && hasBuses && (
              <div className="absolute z-50 mt-2 w-full rounded-2xl border border-border/60 bg-popover p-2 shadow-xl">
                <input
                  placeholder="Buscar placa..."
                  value={busSearch}
                  onChange={(e) => setBusSearch(e.target.value)}
                  autoFocus
                  className={fieldInputClass}
                  style={fieldAccentStyle}
                />

                <div className="unipass-scrollbar mt-2 max-h-56 overflow-y-auto">
                  {filteredBuses.length === 0 ? (
                    <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                      Nenhum ônibus encontrado.
                    </p>
                  ) : (
                    filteredBuses.map((bus) => (
                      <button
                        key={bus.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-accent"
                        onClick={() => {
                          setBusId(bus.id);
                          setBusDropdownOpen(false);
                          setBusSearch("");
                        }}
                      >
                        <span className="tracking-wide">{bus.plate}</span>
                        <Check
                          className={cn(
                            "size-4",
                            bus.id === busId ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </FormField>

        {isEditing && (
          <div className="space-y-3 rounded-2xl border border-border/50 bg-background/50 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Credenciais do dispositivo
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <ReadOnlyValue label="Hardware" value={device?.hardwareId} />
              <ReadOnlyValue label="Código" value={device?.code} />
              <ReadOnlyValue label="Secret" value={device?.secret} masked />
            </div>
            <p className="text-xs text-muted-foreground">
              Geradas no pareamento e usadas pelo firmware. Não são editáveis.
            </p>
          </div>
        )}

        {errorMessage && <p className="text-sm text-red-500">{errorMessage}</p>}
      </div>
    </FormModal>
  );
}

function ReadOnlyValue({
  label,
  value,
  masked = false,
}: {
  label: string;
  value?: string | null;
  masked?: boolean;
}) {
  const display = value
    ? masked
      ? `${value.slice(0, 4)}${"•".repeat(Math.max(value.length - 4, 0))}`
      : value
    : "—";

  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="truncate font-mono text-xs" title={value ?? undefined}>
        {display}
      </p>
    </div>
  );
}
