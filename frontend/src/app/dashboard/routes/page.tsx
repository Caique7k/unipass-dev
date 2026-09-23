"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Plus, Route as RouteIcon } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { buildApiUrl } from "@/services/api";
import { useListQuery } from "../hooks/useListQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DataTable, type Column } from "../components/DataTable";
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
} from "../components/page-kit";
import { RouteModal } from "./components/RouteFormModal";
import { Route } from "./types/route.types";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

export default function RoutesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Route | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Route>(
      "/routes",
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        active: activeFilter,
      },
      { enabled: canView },
    );

  const columns: Column<Route>[] = [
    {
      key: "name",
      header: "Rota",
      cell: (route) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{route.name}</p>
          {route.description && (
            <p className="truncate text-xs text-muted-foreground md:hidden">
              {route.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "description",
      header: "Descrição",
      hideBelow: "md",
      cell: (route) => (
        <span className="line-clamp-1 max-w-[320px] text-muted-foreground">
          {route.description || "—"}
        </span>
      ),
    },
    {
      key: "schedules",
      header: "Horários",
      cell: (route) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            router.push(`/dashboard/routes/${route.id}`);
          }}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1 text-xs transition hover:border-foreground/25 hover:bg-accent"
        >
          <CalendarClock size={12} />
          <span className="tabular-nums">{route._count?.schedules ?? 0}</span>
          <span className="hidden sm:inline">
            {(route._count?.schedules ?? 0) === 1 ? "horário" : "horários"}
          </span>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (route) => (
        <StatusBadge tone={route.active ? "success" : "danger"} dot>
          {route.active ? "Ativa" : "Inativa"}
        </StatusBadge>
      ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar a gestão de rotas." />
    );
  }

  async function handleConfirmDelete() {
    if (selectedIds.length === 0) return;

    try {
      setDeleting(true);

      const response = await fetch(buildApiUrl("/routes/deactivate"), {
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
          ? "Rota desativada com sucesso."
          : "Rotas desativadas com sucesso.",
      );
    } catch {
      toast.error("Erro ao desativar rotas.", {
        description: "Tente novamente em instantes.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operação"
        title="Rotas"
        description={
          canManage
            ? "Organize as linhas e seus horários em um único fluxo."
            : "Visualize as rotas configuradas para a operação."
        }
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "rota" : "rotas"}
            </StatusBadge>
          ) : null
        }
        actions={
          canManage ? (
            <PrimaryButton
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Nova rota
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
          placeholder="Buscar por nome ou descrição..."
          busy={isFetching && search !== debouncedSearch}
        />

        <FilterChips
          layoutId="routes-status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
            setSelectedIds([]);
          }}
          options={[
            { value: "Ativos", label: "Ativas" },
            { value: "Inativos", label: "Inativas" },
            { value: "Todos", label: "Todas" },
          ]}
        />
      </Toolbar>

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(route) => route.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          onRowClick={(route) => router.push(`/dashboard/routes/${route.id}`)}
          selectable={canManage}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isRowSelectable={(route) => route.active}
          onEditRow={
            canManage
              ? (route) => {
                  setEditing(route);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<RouteIcon size={22} />}
          emptyTitle={
            debouncedSearch ? "Nenhuma rota encontrada" : "Nenhuma rota criada"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Crie uma rota para depois cadastrar os horários de ida e volta."
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
                    ? "rota selecionada"
                    : "rotas selecionadas"}
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
          <RouteModal
            open={formOpen}
            onOpenChange={setFormOpen}
            route={editing}
            onSuccess={refetch}
          />

          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={handleConfirmDelete}
            busy={deleting}
            title="Desativar rotas?"
            confirmLabel="Desativar"
            description={
              <>
                Você está prestes a desativar{" "}
                <strong className="text-foreground">{selectedIds.length}</strong>{" "}
                {selectedIds.length === 1 ? "rota" : "rotas"}. Os horários dessas
                rotas deixam de notificar os responsáveis.
              </>
            }
          />
        </>
      )}
    </div>
  );
}
