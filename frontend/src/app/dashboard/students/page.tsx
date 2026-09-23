"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BookUser, Nfc, Plus } from "lucide-react";
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
import { StudentModal } from "./components/StudentsFormModal";
import { useStudentFormOptions } from "./hooks/useStudentFormOptions";
import type { Student } from "./types/student";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

export default function StudentsPage() {
  const { user } = useAuth();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Student>(
      "/students",
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

  // As opções do formulário só começam a carregar quando o modal é aberto pela
  // primeira vez — e ficam em cache depois disso.
  const options = useStudentFormOptions(canManage && formOpen);

  // Nomes dos selecionados, para a confirmação mostrar o que será afetado.
  const selectedNames = rows.filter((student) => selectedIds.includes(student.id)).map((student) => student.name);

  const columns: Column<Student>[] = [
    {
      key: "name",
      header: "Aluno",
      cell: (student) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{student.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {student.registration}
          </p>
        </div>
      ),
    },
    {
      key: "group",
      header: "Grupo",
      hideBelow: "sm",
      cell: (student) =>
        student.group?.name ? (
          <StatusBadge>{student.group.name}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "routes",
      header: "Rotas",
      hideBelow: "lg",
      cell: (student) => {
        const names = student.routes?.map(({ route }) => route.name) ?? [];

        if (names.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <span
            title={names.join(", ")}
            className="line-clamp-1 max-w-[200px] text-muted-foreground"
          >
            {names.join(", ")}
          </span>
        );
      },
    },
    {
      key: "billing",
      header: "Grupo de boleto",
      hideBelow: "xl",
      cell: (student) =>
        student.billingTemplate?.name ? (
          <StatusBadge tone="info">{student.billingTemplate.name}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "rfid",
      header: "TAG",
      hideBelow: "md",
      cell: (student) => {
        const tags = student.rfidCards?.map((card) => card.tag) ?? [];

        if (tags.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <span
            title={tags.join(", ")}
            className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground"
          >
            <Nfc size={12} />
            {tags.length === 1 ? tags[0] : `${tags.length} TAGs`}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (student) => (
        <StatusBadge tone={student.active ? "success" : "danger"} dot>
          {student.active ? "Ativo" : "Inativo"}
        </StatusBadge>
      ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar a gestão de alunos." />
    );
  }

  async function handleConfirmDelete() {
    try {
      setDeleting(true);

      const response = await fetch(buildApiUrl("/students/desactivate"), {
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
          ? "Aluno desativado com sucesso."
          : "Alunos desativados com sucesso.",
      );
    } catch {
      toast.error("Erro ao desativar alunos.", {
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
        title="Alunos"
        description={
          canManage
            ? "Cadastro central do transporte: grupo, rotas, TAG e cobrança."
            : "Visualize os alunos e as informações da operação."
        }
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "aluno" : "alunos"}
            </StatusBadge>
          ) : null
        }
        actions={
          canManage ? (
            <PrimaryButton
              onClick={() => {
                setSelectedStudent(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Novo aluno
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
          placeholder="Buscar por nome ou matrícula..."
          busy={isFetching && search !== debouncedSearch}
        />

        <FilterChips
          layoutId="students-status"
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
          getRowId={(student) => student.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable={canManage}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isRowSelectable={(student) => student.active}
          onEditRow={
            canManage
              ? (student) => {
                  setSelectedStudent(student);
                  setFormOpen(true);
                }
              : undefined
          }
          emptyIcon={<BookUser size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum aluno encontrado"
              : "Nenhum aluno cadastrado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : canManage
                ? "Cadastre o primeiro aluno para vincular TAG, rota e cobrança."
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
                    ? "aluno selecionado"
                    : "alunos selecionados"}
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
          <StudentModal
            open={formOpen}
            onOpenChange={setFormOpen}
            student={selectedStudent}
            emailDomain={user?.emailDomain ?? null}
            groups={options.groups}
            groupsLoading={options.loading}
            groupsLoaded={options.loaded}
            routes={options.routes}
            routesLoading={options.loading}
            routesLoaded={options.loaded}
            billingTemplates={options.billingTemplates}
            billingTemplatesLoading={options.loading}
            billingTemplatesLoaded={options.loaded}
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
                ? "Desativar este aluno?"
                : `Desativar ${selectedIds.length} alunos?`
            }
            description="O aluno sai das listagens e dos relatórios da operação."
            items={selectedNames}
            consequence="A TAG dele deixa de ser aceita no embarque: a próxima leitura vira um evento negado."
          />
        </>
      )}
    </div>
  );
}
