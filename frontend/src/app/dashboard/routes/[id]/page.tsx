"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Bell, CalendarClock, Plus } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { buildApiUrl } from "@/services/api";
import { useListQuery } from "../../hooks/useListQuery";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { DataTable, type Column } from "../../components/DataTable";
import {
  ConfirmDialog,
  ErrorState,
  FilterChips,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SearchField,
  StatusBadge,
  Toolbar,
} from "../../components/page-kit";
import { ScheduleFormModal } from "./components/ScheduleFormModal";
import { Schedule, ScheduleType } from "./types/schedule";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

const scheduleTypeLabel: Record<ScheduleType, string> = {
  GO: "Ida",
  BACK: "Volta",
  SHIFT: "Turno",
};

const scheduleTypeTone: Record<ScheduleType, "accent" | "info" | "neutral"> = {
  GO: "accent",
  BACK: "info",
  SHIFT: "neutral",
};

/** Ordem de exibição da semana, começando na segunda. */
const dayDisplayOrder = [1, 2, 3, 4, 5, 6, 0];
const dayShortLabel: Record<number, string> = {
  0: "D",
  1: "S",
  2: "T",
  3: "Q",
  4: "Q",
  5: "S",
  6: "S",
};
const dayFullLabel: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

/**
 * O horário de saída é gravado no campo UTC do DateTime, então precisa ser lido
 * em UTC — usar a hora local deslocaria o horário em 3 horas.
 */
function formatTime(date: string) {
  const value = new Date(date);

  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(
    value.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

function WeekDots({ dayOfWeeks }: { dayOfWeeks: number[] }) {
  return (
    <div
      className="flex items-center gap-0.5"
      title={
        dayOfWeeks.length === 0
          ? "Nenhum dia"
          : dayDisplayOrder
              .filter((day) => dayOfWeeks.includes(day))
              .map((day) => dayFullLabel[day])
              .join(", ")
      }
    >
      {dayDisplayOrder.map((day, index) => {
        const active = dayOfWeeks.includes(day);

        return (
          <span
            key={`${day}-${index}`}
            className={
              active
                ? "flex h-5 w-5 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold text-background"
                : "flex h-5 w-5 items-center justify-center rounded-md border border-border/60 text-[10px] text-muted-foreground/60"
            }
          >
            {dayShortLabel[day]}
          </span>
        );
      })}
    </div>
  );
}

export default function RouteSchedulesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { id } = useParams();
  const routeId = String(id);

  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [routeName, setRouteName] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Schedule>(
      `/route-schedules/${routeId}`,
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        active: activeFilter,
      },
      {
        enabled: canView && Boolean(routeId),
        // Se a página deixou de existir (último item da página foi desativado),
        // volta para a última página válida em vez de mostrar tabela vazia.
        onPageOutOfRange: setPage,
      },
    );

  useEffect(() => {
    if (!routeId) return;

    const controller = new AbortController();

    async function loadRoute() {
      try {
        const response = await fetch(buildApiUrl(`/routes/${routeId}`), {
          credentials: "include",
          signal: controller.signal,
        });

        if (!response.ok) throw new Error();

        const json = (await response.json()) as { name: string };

        setRouteName(json.name);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        toast.error("Não foi possível carregar a rota.");
      }
    }

    void loadRoute();

    return () => controller.abort();
  }, [routeId]);

  // Nomes dos selecionados, para a confirmação mostrar o que será afetado.
  const selectedNames = rows
      .filter((schedule) => selectedIds.includes(schedule.id))
      .map(
        (schedule) =>
          `${formatTime(schedule.departureTime)} · ${
            schedule.title || scheduleTypeLabel[schedule.type]
          }`,
      );

  const columns: Column<Schedule>[] = [
    {
      key: "departure",
      header: "Saída",
      cell: (schedule) => (
        <span className="font-medium tabular-nums">
          {formatTime(schedule.departureTime)}
        </span>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      cell: (schedule) => (
        <div className="min-w-0">
          <StatusBadge tone={scheduleTypeTone[schedule.type]}>
            {scheduleTypeLabel[schedule.type]}
          </StatusBadge>
          {schedule.title && (
            <p className="mt-1 truncate text-xs text-muted-foreground lg:hidden">
              {schedule.title}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "title",
      header: "Título",
      hideBelow: "lg",
      cell: (schedule) => (
        <span className="line-clamp-1 max-w-[200px] text-muted-foreground">
          {schedule.title || "—"}
        </span>
      ),
    },
    {
      key: "days",
      header: "Dias",
      hideBelow: "sm",
      cell: (schedule) => <WeekDots dayOfWeeks={schedule.dayOfWeeks} />,
    },
    {
      key: "bus",
      header: "Ônibus",
      hideBelow: "md",
      cell: (schedule) => (
        <span className="tracking-wide text-muted-foreground">
          {schedule.bus?.plate || "—"}
        </span>
      ),
    },
    {
      key: "notify",
      header: "Aviso",
      hideBelow: "xl",
      cell: (schedule) => (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Bell size={12} />
          <span className="tabular-nums">{schedule.notifyBeforeMinutes}</span>
          min antes
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (schedule) => (
        <StatusBadge tone={schedule.active ? "success" : "danger"} dot>
          {schedule.active ? "Ativo" : "Inativo"}
        </StatusBadge>
      ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar os horários da rota." />
    );
  }

  async function handleConfirmDelete() {
    if (selectedIds.length === 0) return;

    try {
      setDeleting(true);

      const response = await fetch(buildApiUrl("/route-schedules/deactivate"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: selectedIds }),
      });

      if (!response.ok) throw new Error();

      const removed = selectedIds.length;

      setDeleteOpen(false);
      setSelectedIds([]);

      if (page > 1 && removed >= rows.length) {
        setPage(1);
      } else {
        refetch();
      }

      toast.success(
        removed === 1
          ? "Horário desativado com sucesso."
          : "Horários desativados com sucesso.",
      );
    } catch {
      toast.error("Erro ao desativar horários.", {
        description: "Tente novamente em instantes.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => router.push("/dashboard/routes")}
        className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft size={13} />
        Voltar para rotas
      </button>

      <PageHeader
        eyebrow={routeName || "Rota"}
        title="Horários da rota"
        description="Cada horário dispara o aviso de presença para os responsáveis dos alunos vinculados."
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "horário" : "horários"}
            </StatusBadge>
          ) : null
        }
        actions={
          canManage ? (
            <PrimaryButton
              onClick={() => {
                setSelectedSchedule(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Novo horário
            </PrimaryButton>
          ) : null
        }
      />

      <Toolbar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por tipo, título ou ônibus..."
          busy={isFetching && search !== debouncedSearch}
        />

        <FilterChips
          layoutId="schedules-status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
            setSelectedIds([]);
          }}
          options={[
            { value: "Ativos", label: "Ativos" },
            { value: "Inativos", label: "Inativos" },
            { value: "Todos", label: "Todos" },
          ]}
        />
      </Toolbar>

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(schedule) => schedule.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable={canManage}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isRowSelectable={(schedule) => schedule.active}
          onEditRow={
            canManage
              ? (schedule) => {
                  setSelectedSchedule(schedule);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<CalendarClock size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum horário encontrado"
              : "Nenhum horário cadastrado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Cadastre o horário de saída e os dias da semana em que essa rota opera."
                : undefined
          }
          toolbar={
            canManage && selectedIds.length > 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-accent/40 px-3 py-2">
                <span className="text-xs">
                  <span className="font-semibold tabular-nums">
                    {selectedIds.length}
                  </span>{" "}
                  {selectedIds.length === 1
                    ? "horário selecionado"
                    : "horários selecionados"}
                </span>
                <div className="flex items-center gap-2">
                  <GhostButton onClick={() => setSelectedIds([])}>
                    Limpar
                  </GhostButton>
                  <GhostButton tone="danger" onClick={() => setDeleteOpen(true)}>
                    Desativar
                  </GhostButton>
                </div>
              </div>
            ) : null
          }
        />
      )}

      {canManage && (
        <>
          <ScheduleFormModal
            open={formOpen}
            onOpenChange={setFormOpen}
            routeId={routeId}
            schedule={selectedSchedule}
            onSuccess={refetch}
          />

          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={handleConfirmDelete}
            busy={deleting}
            confirmLabel="Desativar"
            title={
              selectedIds.length === 1
                ? "Desativar este horário?"
                : `Desativar ${selectedIds.length} horários?`
            }
            description="O horário sai da grade da rota."
            items={selectedNames}
            consequence="Os avisos de presença desse horário deixam de ser enviados aos responsáveis."
          />
        </>
      )}
    </div>
  );
}
