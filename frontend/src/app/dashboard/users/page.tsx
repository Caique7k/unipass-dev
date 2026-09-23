"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AtSign, Plus, Users as UsersIcon } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import { roleLabels, type UserRole } from "@/lib/permissions";
import api from "@/services/api";
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
import { UserFormModal } from "./components/UserFormModal";
import type { ManagedUser, UserStatusFilter } from "./types/user";

type RoleFilter = UserRole | "Todos";

const PAGE_SIZE = 10;

const roleTones: Record<UserRole, "accent" | "info" | "warning" | "neutral"> = {
  PLATFORM_ADMIN: "accent",
  ADMIN: "accent",
  COORDINATOR: "info",
  DRIVER: "warning",
  USER: "neutral",
};

export default function UsersPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<UserStatusFilter>("Ativos");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("Todos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<ManagedUser>(
      "/users",
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch.trim(),
        active:
          status === "Todos" ? undefined : status === "Ativos" ? "true" : "false",
        role: roleFilter === "Todos" ? undefined : roleFilter,
      },
      { enabled: canManage },
    );

  const columns: Column<ManagedUser>[] = [
    {
      key: "name",
      header: "Nome",
      cell: (managed) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-[11px] font-semibold uppercase">
            {managed.name?.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{managed.name}</p>
            <p className="truncate text-xs text-muted-foreground sm:hidden">
              {managed.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "E-mail",
      hideBelow: "sm",
      cell: (managed) => (
        <span className="truncate text-muted-foreground">{managed.email}</span>
      ),
    },
    {
      key: "role",
      header: "Perfil",
      cell: (managed) => (
        <StatusBadge tone={roleTones[managed.role] ?? "neutral"}>
          {roleLabels[managed.role]}
        </StatusBadge>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (managed) => (
        <StatusBadge tone={managed.active ? "success" : "danger"} dot>
          {managed.active ? "Ativo" : "Inativo"}
        </StatusBadge>
      ),
    },
  ];

  if (!canManage) {
    return (
      <AccessDenied description="Somente o administrador da empresa pode cadastrar e gerenciar usuários." />
    );
  }

  async function handleConfirmDeactivate() {
    if (selectedIds.length === 0) return;

    try {
      setDeleting(true);
      await api.patch("/users/deactivate", { ids: selectedIds });

      const removed = selectedIds.length;

      toast.success(
        removed === 1
          ? "Usuário desativado com sucesso."
          : "Usuários desativados com sucesso.",
      );

      setDeleteOpen(false);
      setSelectedIds([]);

      if (page > 1 && removed >= rows.length) {
        setPage(1);
      } else {
        refetch();
      }
    } catch (err: unknown) {
      toast.error(
        axios.isAxiosError(err)
          ? (err.response?.data?.message ?? "Erro ao desativar usuários")
          : "Erro ao desativar usuários",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        description="Cadastre administradores, motoristas, coordenadores e alunos da sua empresa."
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "usuário" : "usuários"}
            </StatusBadge>
          ) : null
        }
        actions={
          <PrimaryButton
            onClick={() => {
              setSelectedUser(null);
              setFormOpen(true);
            }}
          >
            <Plus size={15} />
            Novo usuário
          </PrimaryButton>
        }
      />

      <Toolbar className="flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por nome ou e-mail..."
          busy={isFetching && search !== debouncedSearch}
        />

        <div className="flex flex-wrap items-center gap-3">
          <FilterChips
            layoutId="users-status"
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

          <span aria-hidden className="hidden h-5 w-px bg-border lg:block" />

          <FilterChips
            layoutId="users-role"
            value={roleFilter}
            onChange={(value) => {
              setRoleFilter(value);
              setPage(1);
              setSelectedIds([]);
            }}
            options={[
              { value: "Todos", label: "Todos os perfis" },
              { value: "ADMIN", label: "Admin" },
              { value: "COORDINATOR", label: "Coordenador" },
              { value: "DRIVER", label: "Motorista" },
              { value: "USER", label: "Aluno" },
            ]}
          />
        </div>
      </Toolbar>

      {user?.emailDomain && (
        <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <AtSign size={12} />
          Todo usuário desta empresa precisa usar um e-mail{" "}
          <span className="font-medium text-foreground">
            @{user.emailDomain}
          </span>
        </p>
      )}

      {error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(managed) => managed.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          // Não faz sentido desativar quem já está inativo, nem a própria conta.
          isRowSelectable={(managed) =>
            managed.active && managed.id !== user?.id
          }
          onEditRow={(managed) => {
            setSelectedUser(managed);
            setFormOpen(true);
          }}
          emptyIcon={<UsersIcon size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum usuário encontrado"
              : "Nenhum usuário cadastrado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : "Cadastre o primeiro usuário da sua equipe."
          }
          toolbar={
            selectedIds.length > 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-accent/40 px-3 py-2">
                <span className="text-xs">
                  <span className="font-semibold tabular-nums">
                    {selectedIds.length}
                  </span>{" "}
                  {selectedIds.length === 1
                    ? "usuário selecionado"
                    : "usuários selecionados"}
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

      <UserFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        user={selectedUser}
        emailDomain={user?.emailDomain}
        onSuccess={refetch}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleConfirmDeactivate}
        busy={deleting}
        title="Desativar usuários?"
        confirmLabel="Desativar"
        description={
          <>
            Você está prestes a desativar{" "}
            <strong className="text-foreground">{selectedIds.length}</strong>{" "}
            {selectedIds.length === 1 ? "usuário" : "usuários"}. Eles perdem o
            acesso ao painel imediatamente.
          </>
        }
      />
    </div>
  );
}
