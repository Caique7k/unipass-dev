"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Users } from "lucide-react";
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
import { BillingGroupFormModal } from "./components/BillingGroupFormModal";
import {
  billingRecurrenceLabels,
  type BillingGroup,
} from "./types/billing-group";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

function formatCents(amountCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountCents / 100);
}

export default function BillingGroupsPage() {
  const { user } = useAuth();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<BillingGroup | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<BillingGroup>(
      "/billing/templates",
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        active: activeFilter,
      },
      { enabled: canView },
    );

  const columns: Column<BillingGroup>[] = [
    {
      key: "name",
      header: "Grupo",
      cell: (group) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{group.name}</p>
          {group.description && (
            <p className="truncate text-xs text-muted-foreground">
              {group.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Valor",
      cell: (group) => (
        <span className="font-medium tabular-nums">
          {formatCents(group.amountCents)}
        </span>
      ),
    },
    {
      key: "dueDay",
      header: "Vencimento",
      hideBelow: "sm",
      cell: (group) => (
        <span className="text-muted-foreground">
          dia <span className="tabular-nums">{group.dueDay}</span>
        </span>
      ),
    },
    {
      key: "recurrence",
      header: "Recorrência",
      hideBelow: "lg",
      cell: (group) => (
        <StatusBadge tone="info">
          {billingRecurrenceLabels[group.recurrence]}
        </StatusBadge>
      ),
    },
    {
      key: "students",
      header: "Alunos",
      hideBelow: "md",
      cell: (group) => (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Users size={13} />
          <span className="tabular-nums">{group._count?.students ?? 0}</span>
        </span>
      ),
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
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar a gestão de grupos de boletos." />
    );
  }

  async function handleConfirmDelete() {
    try {
      setDeleting(true);

      const response = await fetch(
        buildApiUrl("/billing/templates/deactivate"),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids: selectedIds }),
        },
      );

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
          ? "Grupo de boletos desativado com sucesso."
          : "Grupos de boletos desativados com sucesso.",
      );
    } catch {
      toast.error("Erro ao desativar grupos de boletos.", {
        description: "Tente novamente em instantes.",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Financeiro"
        title="Grupos de boletos"
        description={
          canManage
            ? "Cadastre as mensalidades e regras financeiras que ficam amarradas aos alunos."
            : "Visualize os grupos de boletos da operação financeira."
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
          layoutId="billing-groups-status"
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
          isRowSelectable={(group) => group.active}
          onEditRow={
            canManage
              ? (group) => {
                  setSelectedGroup(group);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<FileText size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum grupo encontrado"
              : "Nenhum grupo de boletos criado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Crie um grupo para definir valor, vencimento e recorrência das mensalidades."
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
          <BillingGroupFormModal
            open={formOpen}
            onOpenChange={setFormOpen}
            billingGroup={selectedGroup}
            onSuccess={refetch}
          />

          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onConfirm={handleConfirmDelete}
            busy={deleting}
            title="Desativar grupos de boletos?"
            confirmLabel="Desativar"
            description={
              <>
                Você está prestes a desativar{" "}
                <strong className="text-foreground">{selectedIds.length}</strong>{" "}
                {selectedIds.length === 1 ? "grupo" : "grupos"}. As cobranças já
                emitidas continuam valendo.
              </>
            }
          />
        </>
      )}
    </div>
  );
}
