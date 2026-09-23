"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ACCENT, EmptyState, Panel } from "./primitives";
import { FetchingBar } from "./page-kit";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Esconde a coluna abaixo do breakpoint, para caber no celular. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
};

const hideClasses = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
} as const;

const alignClasses = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
} as const;

export type DataTableProps<T> = {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;

  /** Primeiro carregamento: mostra linhas em skeleton. */
  loading?: boolean;
  /** Recarga: mostra a barrinha no topo, sem trocar o conteúdo. */
  isFetching?: boolean;

  page?: number;
  lastPage?: number;
  onPageChange?: (page: number) => void;
  total?: number;

  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Linhas que não podem ser selecionadas (ex.: já inativas). */
  isRowSelectable?: (row: T) => boolean;

  onEditRow?: (row: T) => void;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;

  skeletonRows?: number;
  /** Conteúdo acima da tabela (ex.: ação em massa). */
  toolbar?: ReactNode;
};

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  loading = false,
  isFetching = false,
  page = 1,
  lastPage = 1,
  onPageChange,
  total,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  isRowSelectable,
  onEditRow,
  onRowClick,
  rowActions,
  emptyTitle = "Nada por aqui ainda",
  emptyDescription,
  emptyIcon,
  skeletonRows = 8,
  toolbar,
}: DataTableProps<T>) {
  const reduceMotion = useReducedMotion();

  const selectableRows = useMemo(
    () => rows.filter((row) => !isRowSelectable || isRowSelectable(row)),
    [rows, isRowSelectable],
  );

  // A seleção é sempre reconciliada com a página atual: sem isso, um id de uma
  // página anterior continuaria contando na ação em massa.
  const visibleSelected = useMemo(
    () =>
      selectedIds.filter((id) =>
        selectableRows.some((row) => getRowId(row) === id),
      ),
    [selectedIds, selectableRows, getRowId],
  );

  const allSelected =
    selectableRows.length > 0 &&
    visibleSelected.length === selectableRows.length;

  function toggleAll() {
    if (!onSelectionChange) return;

    onSelectionChange(
      allSelected ? [] : selectableRows.map((row) => getRowId(row)),
    );
  }

  function toggleRow(id: string) {
    if (!onSelectionChange) return;

    onSelectionChange(
      visibleSelected.includes(id)
        ? visibleSelected.filter((item) => item !== id)
        : [...visibleSelected, id],
    );
  }

  const colSpan =
    columns.length + (selectable ? 1 : 0) + (onEditRow || rowActions ? 1 : 0);

  return (
    <div className="space-y-3">
      {toolbar}

      <Panel className="relative">
        <FetchingBar active={isFetching && !loading} />

        <div className="w-full overflow-x-auto overflow-y-hidden">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-border/60">
                {selectable && (
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      disabled={selectableRows.length === 0}
                      aria-label="Selecionar todos desta página"
                      className="cursor-pointer"
                    />
                  </th>
                )}

                {columns.map((column) => (
                  <th
                    key={column.key}
                    className={cn(
                      "px-4 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground",
                      alignClasses[column.align ?? "left"],
                      column.hideBelow && hideClasses[column.hideBelow],
                      column.headerClassName,
                    )}
                  >
                    {column.header}
                  </th>
                ))}

                {(onEditRow || rowActions) && (
                  <th className="w-[72px] px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Ações
                  </th>
                )}
              </tr>
            </thead>

            <tbody>
              {loading &&
                Array.from({ length: skeletonRows }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="border-b border-border/40">
                    {selectable && (
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-4 rounded" />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-3",
                          column.hideBelow && hideClasses[column.hideBelow],
                        )}
                      >
                        <Skeleton className="h-4 w-full max-w-[160px] rounded" />
                      </td>
                    ))}
                    {(onEditRow || rowActions) && (
                      <td className="px-4 py-3">
                        <Skeleton className="ml-auto h-7 w-7 rounded-lg" />
                      </td>
                    )}
                  </tr>
                ))}

              {!loading &&
                rows.map((row, index) => {
                  const id = getRowId(row);
                  const selected = visibleSelected.includes(id);
                  const canSelect = !isRowSelectable || isRowSelectable(row);

                  return (
                    <motion.tr
                      key={id}
                      // Só opacidade: um deslocamento vertical aqui faz o
                      // contêiner da tabela piscar uma barra de rolagem.
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{
                        duration: 0.2,
                        delay: Math.min(index * 0.018, 0.25),
                      }}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        "border-b border-border/40 transition-colors last:border-0",
                        onRowClick && "cursor-pointer",
                        selected ? "bg-accent/40" : "hover:bg-accent/30",
                      )}
                    >
                      {selectable && (
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={selected}
                            disabled={!canSelect}
                            onCheckedChange={() => toggleRow(id)}
                            aria-label="Selecionar linha"
                            className="cursor-pointer"
                          />
                        </td>
                      )}

                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            "px-4 py-3",
                            alignClasses[column.align ?? "left"],
                            column.hideBelow && hideClasses[column.hideBelow],
                            column.className,
                          )}
                        >
                          {column.cell(row)}
                        </td>
                      ))}

                      {(onEditRow || rowActions) && (
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            {rowActions?.(row)}
                            {onEditRow && (
                              <button
                                type="button"
                                onClick={() => onEditRow(row)}
                                aria-label="Editar"
                                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition hover:border-foreground/25 hover:text-foreground"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  );
                })}

              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan}>
                    <EmptyState
                      icon={emptyIcon}
                      title={emptyTitle}
                      description={emptyDescription}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {onPageChange && (lastPage > 1 || total !== undefined) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            {total !== undefined && (
              <>
                <span className="font-medium tabular-nums text-foreground">
                  {total}
                </span>{" "}
                {total === 1 ? "registro" : "registros"}
                {lastPage > 1 && " · "}
              </>
            )}
            {lastPage > 1 && (
              <>
                página{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {page}
                </span>{" "}
                de <span className="tabular-nums">{lastPage}</span>
              </>
            )}
          </p>

          {lastPage > 1 && (
            <Pagination
              page={page}
              lastPage={lastPage}
              onPageChange={onPageChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Pagination({
  page,
  lastPage,
  onPageChange,
}: {
  page: number;
  lastPage: number;
  onPageChange: (page: number) => void;
}) {
  // Sempre mostra primeira e última página; o miolo acompanha a página atual e
  // as reticências indicam o salto. Sem isso, em 50 páginas não havia como
  // chegar ao fim sem clicar 48 vezes.
  const windowSize = 5;
  const half = Math.floor(windowSize / 2);

  let start = Math.max(1, page - half);
  const end = Math.min(lastPage, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const middle: number[] = [];
  for (let index = start; index <= end; index++) {
    middle.push(index);
  }

  const showLeftEllipsis = start > 2;
  const showRightEllipsis = end < lastPage - 1;

  return (
    <div className="flex items-center gap-1">
      <PageButton
        onClick={() => onPageChange(1)}
        disabled={page <= 1}
        label="Primeira página"
      >
        <ChevronsLeft size={14} />
      </PageButton>

      <PageButton
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        label="Página anterior"
      >
        <ChevronLeft size={14} />
      </PageButton>

      {start > 1 && (
        <PageNumber page={1} current={page} onPageChange={onPageChange} />
      )}
      {showLeftEllipsis && <Ellipsis />}

      {middle
        .filter((item) => item !== 1 || start === 1)
        .filter((item) => item !== lastPage || end === lastPage)
        .map((item) => (
          <PageNumber
            key={item}
            page={item}
            current={page}
            onPageChange={onPageChange}
          />
        ))}

      {showRightEllipsis && <Ellipsis />}
      {end < lastPage && (
        <PageNumber
          page={lastPage}
          current={page}
          onPageChange={onPageChange}
        />
      )}

      <PageButton
        onClick={() => onPageChange(page + 1)}
        disabled={page >= lastPage}
        label="Próxima página"
      >
        <ChevronRight size={14} />
      </PageButton>

      <PageButton
        onClick={() => onPageChange(lastPage)}
        disabled={page >= lastPage}
        label="Última página"
      >
        <ChevronsRight size={14} />
      </PageButton>
    </div>
  );
}

function Ellipsis() {
  return (
    <span
      aria-hidden
      className="px-1 text-xs text-muted-foreground/60 select-none"
    >
      …
    </span>
  );
}

function PageNumber({
  page,
  current,
  onPageChange,
}: {
  page: number;
  current: number;
  onPageChange: (page: number) => void;
}) {
  const active = page === current;

  return (
    <button
      type="button"
      onClick={() => onPageChange(page)}
      aria-current={active ? "page" : undefined}
      aria-label={`Página ${page}`}
      className={cn(
        "h-8 min-w-8 cursor-pointer rounded-lg px-2 text-xs tabular-nums transition",
        active
          ? "text-white"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      style={active ? { backgroundColor: ACCENT } : undefined}
    >
      {page}
    </button>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
