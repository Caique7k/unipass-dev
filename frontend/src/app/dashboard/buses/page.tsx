"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Truck, Users } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { buildApiUrl } from "@/services/api";
import { useListQuery } from "../hooks/useListQuery";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { DataTable, type Column } from "../components/DataTable";
import {
  ConfirmDialog,
  ErrorState,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SearchField,
  StatusBadge,
  Toolbar,
} from "../components/page-kit";
import { BusFormModal } from "./components/BusFormModal";
import { Bus } from "./types/bus";

const PAGE_SIZE = 10;

export default function BusesPage() {
  const { user } = useAuth();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedBus, setSelectedBus] = useState<Bus | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Bus>(
      "/buses",
      { page, limit: PAGE_SIZE, search: debouncedSearch },
      { enabled: canView },
    );

  const totalCapacity = useMemo(
    () => rows.reduce((sum, bus) => sum + (bus.capacity ?? 0), 0),
    [rows],
  );

  const columns: Column<Bus>[] = [
    {
      key: "plate",
      header: "Placa",
      cell: (bus) => (
        <span className="font-medium tracking-wide">{bus.plate}</span>
      ),
    },
    {
      key: "capacity",
      header: "Capacidade",
      cell: (bus) => (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Users size={13} />
          <span className="tabular-nums">{bus.capacity}</span>
          <span className="hidden sm:inline">lugares</span>
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Cadastrado em",
      hideBelow: "md",
      cell: (bus) => (
        <span className="text-muted-foreground tabular-nums">
          {bus.createdAt
            ? new Intl.DateTimeFormat("pt-BR").format(new Date(bus.createdAt))
            : "—"}
        </span>
      ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar a gestão de ônibus." />
    );
  }

  async function handleConfirmDelete() {
    try {
      setDeleting(true);

      const response = await fetch(buildApiUrl("/buses"), {
        method: "delete",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: selectedIds }),
      });

      if (!response.ok) throw new Error();

      const removed = selectedIds.length;

      setDeleteOpen(false);
      setSelectedIds([]);

      // Se a página atual pode ter ficado vazia, volta para a primeira.
      if (page > 1 && removed >= rows.length) {
        setPage(1);
      } else {
        refetch();
      }

      toast.success(
        removed === 1
          ? "Ônibus desativado com sucesso."
          : "Ônibus desativados com sucesso.",
      );
    } catch {
      toast.error("Erro ao remover ônibus", {
        description: "Tente novamente mais tarde.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operação"
        title="Ônibus"
        description={
          canManage
            ? "Gerencie os veículos cadastrados na sua empresa."
            : "Visualize todos os ônibus da operação."
        }
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "veículo" : "veículos"}
            </StatusBadge>
          ) : null
        }
        actions={
          canManage ? (
            <PrimaryButton
              onClick={() => {
                setSelectedBus(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Novo ônibus
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
          placeholder="Buscar pela placa..."
          busy={isFetching && search !== debouncedSearch}
        />

        {rows.length > 0 && (
          <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
            {totalCapacity} lugares nesta página
          </span>
        )}
      </Toolbar>

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(bus) => bus.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable={canManage}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onEditRow={
            canManage
              ? (bus) => {
                  setSelectedBus(bus);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<Truck size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum ônibus encontrado"
              : "Nenhum ônibus cadastrado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Cadastre o primeiro veículo para começar a vincular UniHubs e rotas."
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
                    ? "ônibus selecionado"
                    : "ônibus selecionados"}
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
          <BusFormModal
            open={formOpen}
            setOpen={setFormOpen}
            bus={selectedBus}
            onSuccess={refetch}
          />

          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={handleConfirmDelete}
            busy={deleting}
            title="Desativar ônibus?"
            confirmLabel="Desativar"
            description={
              <>
                Você está prestes a desativar{" "}
                <strong className="text-foreground">{selectedIds.length}</strong>{" "}
                {selectedIds.length === 1 ? "ônibus" : "ônibus"}. Essa ação não
                pode ser desfeita.
              </>
            }
          />
        </>
      )}
    </div>
  );
}
