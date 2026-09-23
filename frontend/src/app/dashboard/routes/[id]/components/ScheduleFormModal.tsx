"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  FormModal,
  ModalCancelButton,
  ModalSubmitButton,
} from "../../../components/FormModal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { buildApiUrl } from "@/services/api";
import { Schedule, ScheduleType } from "../types/schedule";
import { DaysCombobox, type DayOption } from "./DaysCombobox";
import { TimeSelect } from "./TimeSelect";

type BusOption = {
  id: string;
  plate: string;
};

type SaveScheduleResponse = {
  message?: string | string[];
};

const SCHEDULE_TITLE_MAX_LENGTH = 120;
const MAX_NOTIFY_BEFORE_MINUTES = 1439;

const scheduleTypeOptions: Array<{
  value: ScheduleType;
  label: string;
  description: string;
  titlePlaceholder: string;
}> = [
  {
    value: "GO",
    label: "Ida",
    description: "Use para viagens de ida desta rota.",
    titlePlaceholder: "Ex.: Ida campus - manha",
  },
  {
    value: "BACK",
    label: "Volta",
    description: "Use para viagens de volta desta rota.",
    titlePlaceholder: "Ex.: Volta centro - 18h",
  },
  {
    value: "SHIFT",
    label: "Turno",
    description: "Use quando o horário representa um turno específico.",
    titlePlaceholder: "Ex.: Turno noturno",
  },
];

const dayOptions: DayOption[] = [
  { value: 1, label: "Segunda", shortLabel: "Seg" },
  { value: 2, label: "Terca", shortLabel: "Ter" },
  { value: 3, label: "Quarta", shortLabel: "Qua" },
  { value: 4, label: "Quinta", shortLabel: "Qui" },
  { value: 5, label: "Sexta", shortLabel: "Sex" },
  { value: 6, label: "Sabado", shortLabel: "Sab" },
  { value: 0, label: "Domingo", shortLabel: "Dom" },
];

const allDayValues = dayOptions.map((option) => option.value);

function formatTimeInput(date?: string) {
  if (!date) {
    return "";
  }

  const current = new Date(date);
  const hours = String(current.getUTCHours()).padStart(2, "0");
  const minutes = String(current.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildDepartureTimestamp(time: string) {
  const [hours, minutes] = time.split(":");
  return Date.UTC(1970, 0, 1, Number(hours), Number(minutes), 0, 0);
}

function formatDaySummary(selectedDays: number[]) {
  if (selectedDays.length === 0) {
    return "Nenhum dia selecionado";
  }

  return dayOptions
    .filter((option) => selectedDays.includes(option.value))
    .map((option) => option.shortLabel)
    .join(", ");
}

function normalizeSelectedDays(days: number[]) {
  return dayOptions
    .filter((option) => days.includes(option.value))
    .map((option) => option.value);
}

function isEveryDaySelected(days: number[]) {
  return allDayValues.every((day) => days.includes(day));
}

export function ScheduleFormModal({
  open,
  onOpenChange,
  routeId,
  schedule,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  schedule?: Schedule | null;
  onSuccess: () => void;
}) {
  const [type, setType] = useState<ScheduleType>("GO");
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [applyEveryDay, setApplyEveryDay] = useState(false);
  const [busId, setBusId] = useState("none");
  const [notifyBeforeMinutes, setNotifyBeforeMinutes] = useState("30");
  const [buses, setBuses] = useState<BusOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = !!schedule?.id;

  const selectedDaysSummary = useMemo(() => {
    if (applyEveryDay) {
      return "Todos os dias";
    }

    return formatDaySummary(selectedDays);
  }, [applyEveryDay, selectedDays]);

  const currentTypeOption =
    scheduleTypeOptions.find((option) => option.value === type) ??
    scheduleTypeOptions[0];
  const trimmedTitle = title.trim();
  const busSummary =
    busId === "none"
      ? "Sem ônibus vinculado"
      : buses.find((bus) => bus.id === busId)?.plate ?? "Ônibus selecionado";

  useEffect(() => {
    if (schedule) {
      const normalizedDays = normalizeSelectedDays(schedule.dayOfWeeks ?? []);
      const isEveryDay = isEveryDaySelected(normalizedDays);

      setType(schedule.type);
      setTitle(schedule.title || "");
      setTime(formatTimeInput(schedule.departureTime));
      setApplyEveryDay(isEveryDay);
      setSelectedDays(isEveryDay ? [] : normalizedDays);
      setBusId(schedule.bus?.id || "none");
      setNotifyBeforeMinutes(String(schedule.notifyBeforeMinutes));
      return;
    }

    setType("GO");
    setTitle("");
    setTime("");
    setApplyEveryDay(false);
    setSelectedDays([]);
    setBusId("none");
    setNotifyBeforeMinutes("30");
  }, [open, schedule]);

  useEffect(() => {
    if (!open) {
      return;
    }

    async function loadBuses() {
      try {
        const response = await fetch(
          `${buildApiUrl("/buses")}?page=1&limit=100`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          throw new Error();
        }

        const json = (await response.json()) as {
          data: BusOption[];
        };

        setBuses(json.data);
      } catch {
        toast.error("Não foi possível carregar os ônibus.");
      }
    }

    void loadBuses();
  }, [open]);

  function toggleDay(day: number) {
    setApplyEveryDay(false);
    setSelectedDays((currentDays) => {
      if (currentDays.includes(day)) {
        return currentDays.filter((value) => value !== day);
      }

      return [...currentDays, day].sort((left, right) => {
        const leftIndex = dayOptions.findIndex(
          (option) => option.value === left,
        );
        const rightIndex = dayOptions.findIndex(
          (option) => option.value === right,
        );
        return leftIndex - rightIndex;
      });
    });
  }

  async function handleSubmit() {
    const normalizedTitle = trimmedTitle;
    const parsedNotifyBeforeMinutes = Number(notifyBeforeMinutes);

    if (!time) {
      toast.error("Informe o horário.");
      return;
    }

    if (normalizedTitle.length > SCHEDULE_TITLE_MAX_LENGTH) {
      toast.error(
        `O titulo pode ter no maximo ${SCHEDULE_TITLE_MAX_LENGTH} caracteres.`,
      );
      return;
    }

    if (!Number.isInteger(parsedNotifyBeforeMinutes)) {
      toast.error("Informe uma antecedencia valida em minutos.");
      return;
    }

    if (
      parsedNotifyBeforeMinutes < 0 ||
      parsedNotifyBeforeMinutes > MAX_NOTIFY_BEFORE_MINUTES
    ) {
      toast.error(
        `A antecedencia deve ficar entre 0 e ${MAX_NOTIFY_BEFORE_MINUTES} minutos.`,
      );
      return;
    }

    if (!applyEveryDay && selectedDays.length === 0) {
      toast.error("Selecione pelo menos um dia ou marque todos os dias.");
      return;
    }

    const payload = {
      routeId,
      type,
      title: normalizedTitle || undefined,
      departureTime: buildDepartureTimestamp(time),
      dayOfWeeks: applyEveryDay ? allDayValues : selectedDays,
      busId: busId === "none" ? null : busId,
      notifyBeforeMinutes: parsedNotifyBeforeMinutes,
    };

    try {
      setIsSaving(true);

      const response = await fetch(
        isEdit
          ? buildApiUrl(`/route-schedules/${schedule?.id}`)
          : buildApiUrl("/route-schedules"),
        {
          method: isEdit ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(
            isEdit ? { ...payload, routeId: undefined } : payload,
          ),
        },
      );

      const data = (await response.json()) as SaveScheduleResponse;

      if (!response.ok) {
        const errorMessage = Array.isArray(data.message)
          ? data.message.join(", ")
          : data.message;
        throw new Error(errorMessage || "Erro ao salvar horário");
      }

      toast.success(
        isEdit
          ? "Horário atualizado com sucesso."
          : "Horário criado com sucesso.",
      );

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao salvar horário.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <FormModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      icon={<CalendarClock size={18} />}
      title={isEdit ? "Editar horário" : "Novo horário"}
      description={
        isEdit
          ? "Atualize tipo, horário, recorrência e vinculação deste cadastro."
          : "Defina tipo, horário e os dias da semana em que esta rota opera."
      }
      footer={
        <>
          <ModalCancelButton onClick={() => onOpenChange(false)} />
          <ModalSubmitButton onClick={handleSubmit} busy={isSaving}>
            {isEdit ? "Salvar alterações" : "Criar horário"}
          </ModalSubmitButton>
        </>
      }
    >
        <div className="space-y-6">
          <div className="grid gap-4 rounded-2xl border border-border/60 bg-card/70 p-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-[#ff5c00]/8 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff5c00]">
                Operação
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {currentTypeOption.label}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentTypeOption.description}
              </p>
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-background/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Resumo rápido
              </p>
              <p className="mt-2 text-base font-semibold text-foreground">
                {time || "Defina o horário"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedDaysSummary}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {busSummary}
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Tipo de horário</Label>
              <Select
                value={type}
                onValueChange={(value) =>
                  setType((value ?? "GO") as ScheduleType)
                }
              >
                <SelectTrigger className="h-11 w-full cursor-pointer rounded-xl border-border/70 bg-background px-3">
                  <SelectValue>
                    {currentTypeOption.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {scheduleTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {currentTypeOption.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notify-before" className="text-sm font-medium">
                Antecedência do alerta
              </Label>
              <Input
                id="notify-before"
                type="number"
                min={0}
                max={MAX_NOTIFY_BEFORE_MINUTES}
                value={notifyBeforeMinutes}
                className="h-11 rounded-xl border-border/70 bg-background px-3"
                onChange={(event) =>
                  setNotifyBeforeMinutes(event.target.value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Defina quantos minutos antes o responsável recebe o aviso.
              </p>
            </div>
          </div>

          <TimeSelect
            value={time}
            onValueChange={setTime}
            description={`Escolha a hora e os minutos deste horário de ${currentTypeOption.label.toLowerCase()}.`}
          />

          <DaysCombobox
            options={dayOptions}
            selectedValues={selectedDays}
            applyEveryDay={applyEveryDay}
            summary={selectedDaysSummary}
            onToggleDay={toggleDay}
            onApplyEveryDayChange={(nextValue) => {
              setApplyEveryDay(nextValue);

              if (nextValue) {
                setSelectedDays([]);
              }
            }}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="schedule-title" className="text-sm font-medium">
                Identificação do horário
              </Label>
              <Input
                id="schedule-title"
                placeholder={currentTypeOption.titlePlaceholder}
                value={title}
                maxLength={SCHEDULE_TITLE_MAX_LENGTH}
                className="h-11 rounded-xl border-border/70 bg-background px-3"
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Opcional. Use para diferenciar turnos, bairros ou observações.
                </span>
                <span>{trimmedTitle.length}/{SCHEDULE_TITLE_MAX_LENGTH}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Ônibus vinculado</Label>
              <Select
                value={busId}
                onValueChange={(value) => setBusId(value ?? "none")}
              >
                <SelectTrigger className="h-11 w-full cursor-pointer rounded-xl border-border/70 bg-background px-3">
                  <SelectValue>
                    {busId === "none"
                      ? "Sem ônibus vinculado"
                      : buses.find((bus) => bus.id === busId)?.plate}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem ônibus vinculado</SelectItem>
                  {buses.map((bus) => (
                    <SelectItem key={bus.id} value={bus.id}>
                      {bus.plate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {busId === "none"
                  ? "Você pode salvar agora e vincular o ônibus depois."
                  : `Ônibus selecionado: ${busSummary}.`}
              </p>
            </div>

            <div className="rounded-2xl border border-dashed border-border bg-background/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Configuracao atual
              </p>
              <p className="mt-2 break-words text-base font-semibold text-foreground">
                {trimmedTitle || `${currentTypeOption.label} sem titulo`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {time || "Sem horário definido"} - {selectedDaysSummary}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {busSummary}
              </p>
            </div>
          </div>

        </div>
    </FormModal>
  );
}
