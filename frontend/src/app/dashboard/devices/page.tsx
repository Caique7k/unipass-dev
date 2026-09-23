"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HelpCircle, Plus, SmartphoneNfc } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
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
import { DeviceModal } from "./components/DeviceFormModal";
import { CreateDeviceModal } from "./components/CreateDeviceModal";
import type { Device } from "./types/device";

type StatusFilter = "Ativos" | "Inativos" | "Todos";

const PAGE_SIZE = 10;

export default function DevicesPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("Ativos");
  const debouncedSearch = useDebouncedValue(search);

  const [formOpen, setFormOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const activeFilter = status === "Todos" ? undefined : status === "Ativos";

  const { rows, lastPage, total, loading, isFetching, error, refetch } =
    useListQuery<Device>(
      "/devices",
      {
        page,
        limit: PAGE_SIZE,
        search: debouncedSearch,
        active: activeFilter,
      },
      {
        enabled: canManage,
        // Se a página deixou de existir (último item da página foi desativado),
        // volta para a última página válida em vez de mostrar tabela vazia.
        onPageOutOfRange: setPage,
      },
    );

  // Nomes dos selecionados, para a confirmação mostrar o que será afetado.
  const selectedNames = rows
    .filter((device) => selectedIds.includes(device.id))
    .map((device) => device.name || device.code || device.hardwareId);

  const columns: Column<Device>[] = [
    {
      key: "name",
      header: "Nome",
      cell: (device) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {device.name || "UniHub sem nome"}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground md:hidden">
            {device.hardwareId}
          </p>
        </div>
      ),
    },
    {
      key: "hardwareId",
      header: "Hardware",
      hideBelow: "md",
      cell: (device) => (
        <span className="font-mono text-xs text-muted-foreground">
          {device.hardwareId}
        </span>
      ),
    },
    {
      key: "code",
      header: "Código",
      hideBelow: "lg",
      cell: (device) =>
        device.code ? (
          <span className="font-mono text-xs text-muted-foreground">
            {device.code}
          </span>
        ) : (
          <StatusBadge tone="warning">aguardando pareamento</StatusBadge>
        ),
    },
    {
      key: "status",
      header: "Status",
      cell: (device) => (
        <StatusBadge tone={device.active ? "success" : "danger"} dot>
          {device.active ? "Ativo" : "Inativo"}
        </StatusBadge>
      ),
    },
  ];

  if (!canManage) {
    return (
      <AccessDenied description="Somente o administrador da empresa pode gerenciar UniHubs." />
    );
  }

  async function handleConfirmDelete() {
    if (selectedIds.length === 0) return;

    try {
      setDeleting(true);
      await api.delete("/devices", { data: { ids: selectedIds } });

      const removed = selectedIds.length;

      toast.success(
        removed === 1
          ? "UniHub desativado com sucesso."
          : "UniHubs desativados com sucesso.",
      );

      setDeleteOpen(false);
      setSelectedIds([]);

      if (page > 1 && removed >= rows.length) {
        setPage(1);
      } else {
        refetch();
      }
    } catch {
      toast.error("Não foi possível desativar o UniHub.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operação"
        title="UniHub"
        description="Pareie e gerencie os dispositivos instalados nos ônibus."
        meta={
          !loading && total > 0 ? (
            <StatusBadge tone="accent">
              {total} {total === 1 ? "dispositivo" : "dispositivos"}
            </StatusBadge>
          ) : null
        }
        actions={
          <>
            <GhostButton onClick={() => setHowToOpen(true)}>
              <HelpCircle size={15} />
              <span className="hidden sm:inline">Como parear</span>
            </GhostButton>
            <PrimaryButton
              onClick={() => {
                setSelectedDevice(null);
                setFormOpen(true);
              }}
            >
              <Plus size={15} />
              Parear dispositivo
            </PrimaryButton>
          </>
        }
      />

      <Toolbar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Buscar por nome, código ou hardware..."
          busy={isFetching && search !== debouncedSearch}
        />

        <FilterChips
          layoutId="devices-status"
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
          getRowId={(device) => device.id}
          loading={loading}
          isFetching={isFetching}
          page={page}
          lastPage={lastPage}
          total={total}
          onPageChange={setPage}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          isRowSelectable={(device) => device.active}
          onEditRow={(device) => {
            setSelectedDevice(device);
            setFormOpen(true);
          }}
          emptyIcon={<SmartphoneNfc size={22} />}
          emptyTitle={
            debouncedSearch
              ? "Nenhum UniHub encontrado"
              : "Nenhum UniHub pareado"
          }
          emptyDescription={
            debouncedSearch
              ? `Nada corresponde a "${debouncedSearch}".`
              : "Ligue o dispositivo no ônibus e use o código exibido na tela dele para parear."
          }
          toolbar={
            selectedIds.length > 0 ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-accent/40 px-3 py-2">
                <span className="text-xs">
                  <span className="font-semibold tabular-nums">
                    {selectedIds.length}
                  </span>{" "}
                  {selectedIds.length === 1
                    ? "dispositivo selecionado"
                    : "dispositivos selecionados"}
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

      <DeviceModal
        open={formOpen}
        onOpenChange={setFormOpen}
        device={selectedDevice}
        onSuccess={refetch}
      />

      <CreateDeviceModal open={howToOpen} onOpenChange={setHowToOpen} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleConfirmDelete}
        busy={deleting}
        confirmLabel="Desativar"
        title={
          selectedIds.length === 1
            ? "Desativar este UniHub?"
            : `Desativar ${selectedIds.length} UniHubs?`
        }
        description="O dispositivo é desvinculado da operação da empresa."
        items={selectedNames}
        consequence="Ele para de registrar embarques e de enviar localização na hora."
      />
    </div>
  );
}
