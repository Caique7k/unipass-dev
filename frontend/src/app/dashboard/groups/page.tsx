"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Layers3, Plus } from "lucide-react";
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
import { GroupFormModal } from "./components/GroupFormModal";
import type { Group } from "./types/group";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

export default function GroupsPage() {
  const { user } = useAuth();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Group>(
      "/groups",
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        active: activeFilter,
      },
      {
        enabled: canView,
        // Se a página deixou de existir (último item da página foi desativado),
        // volta para a última página válida em vez de mostrar tabela vazia.
        onPageOutOfRange: setPage,
      },
    );

  // Nomes dos selecionados, para a confirmação mostrar o que será afetado.
  const selectedNames = rows.filter((group) => selectedIds.includes(group.id)).map((group) => group.name);

  const columns: Column<Group>[] = [
    {
      key: "name",
      header: "Nome",
      cell: (group) => <span className="font-medium">{group.name}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (group) => (
        <StatusBadge tone={group.active ? "success" : "danger"} dot>
          {group.active ? "Ativo" : "Inativo"}
        </StatusBadge>
      ),
    },
    {
      key: "createdAt",
      header: "Criado em",
      hideBelow: "md",
      cell: (group) => (
        <span className="tabular-nums text-muted-foreground">
          {group.createdAt
            ? new Intl.DateTimeFormat("pt-BR").format(new Date(group.createdAt))
            : "—"}
        </span>
      ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar a gestão de grupos." />
    );
  }

  async function handleConfirmDelete() {
    try {
      setDeleting(true);

      const response = await fetch(buildApiUrl("/groups/deactivate"), {
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
          ? "Grupo desativado com sucesso."
          : "Grupos desativados com sucesso.",
      );
    } catch {
      toast.error("Erro ao desativar grupos.", {
        description: "Tente novamente em instantes.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Pessoas"
        title="Grupos"
        description={
          canManage
            ? "Organize os alunos em turmas para relatórios e agrupamento visual."
            : "Visualize os grupos cadastrados para a operação."
        }
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "grupo" : "grupos"}
            </StatusBadge>
          ) : null
        }
        actions={
          canManage ? (
            <PrimaryButton
              onClick={() => {
                setSelectedGroup(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Novo grupo
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
          placeholder="Buscar por nome do grupo..."
          busy={isFetching && search !== debouncedSearch}
        />

        <FilterChips
          layoutId="groups-status"
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
          getRowId={(group) => group.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable={canManage}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          // Um grupo já inativo não pode ser desativado de novo.
          isRowSelectable={(group) => group.active}
          onEditRow={
            canManage
              ? (group) => {
                  setSelectedGroup(group);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<Layers3 size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum grupo encontrado"
              : "Nenhum grupo cadastrado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Crie o primeiro grupo para organizar seus alunos."
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
                    ? "grupo selecionado"
                    : "grupos selecionados"}
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
          <GroupFormModal
            open={formOpen}
            onOpenChange={setFormOpen}
            group={selectedGroup}
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
                ? "Desativar este grupo?"
                : `Desativar ${selectedIds.length} grupos?`
            }
            description="O grupo some das listagens e dos relatórios."
            items={selectedNames}
            consequence="Os alunos vinculados continuam cadastrados, apenas sem grupo."
          />
        </>
      )}
    </div>
  );
}
