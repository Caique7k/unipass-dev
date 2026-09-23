"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  ChevronDown,
  Clock,
  LogIn,
  RefreshCw,
  Truck,
  UserCheck,
  UserX,
} from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AccessDenied } from "@/components/AccessDenied";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "../components/DataTable";
import {
  ErrorState,
  GhostButton,
  PageHeader,
  SearchField,
  StatusBadge,
  Toolbar,
} from "../components/page-kit";
import {
  ACCENT,
  AnimatedNumber,
  EmptyState,
  Panel,
  SectionLabel,
} from "../components/primitives";

const BOARDED_PAGE_SIZE = 5;
const REFRESH_INTERVAL_MS = 30000;

type BoardedStudent = {
  id: string;
  name: string;
  registration: string;
  group: { id: string; name: string } | null;
  firstBoardingAt: string;
  secondBoardingAt: string;
  busFilterKey: string;
  busPlate: string;
  capacity: number | null;
  deviceCode: string | null;
  deviceName: string | null;
};

type WaitingStudent = {
  id: string;
  name: string;
  registration: string;
  email: string | null;
  phone: string | null;
  group: { id: string; name: string } | null;
  rfidTag: string | null;
  routeNames: string[];
  firstBoardingAt: string;
  firstDeviceCode: string | null;
  firstDeviceName: string | null;
  firstBusPlate: string;
};

type BoardingOverviewResponse = {
  dateKey: string;
  generatedAt: string;
  summary: {
    studentsWithFirstBoarding: number;
    waitingSecondBoarding: number;
    secondBoardingDone: number;
    busesWithSecondBoarding: number;
  };
  busOptions: Array<{ value: string; label: string }>;
  boardedStudents: BoardedStudent[];
  notBoardedStudents: WaitingStudent[];
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateKey(dateKey: string) {
  if (!dateKey) return "--/--/----";

  const [year, month, day] = dateKey.split("-");

  return `${day}/${month}/${year}`;
}

function formatLastUpdated(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function matchesSearch(value: string, search: string) {
  return value.toLowerCase().includes(search.trim().toLowerCase());
}

export default function BoardingPage() {
  const { user } = useAuth();
  const canView = ["ADMIN", "DRIVER", "COORDINATOR"].includes(user?.role ?? "");

  const [data, setData] = useState<BoardingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [waitingSearch, setWaitingSearch] = useState("");
  const [boardedSearch, setBoardedSearch] = useState("");
  const [busFilter, setBusFilter] = useState("all");
  const [boardedPage, setBoardedPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!canView) return;

    setRefreshing(true);

    try {
      const response = await api.get<BoardingOverviewResponse>(
        "/transport/boarding-overview/today",
      );

      setData(response.data);
      setError(null);
    } catch {
      setError("Não foi possível carregar o painel de embarques.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canView]);

  useEffect(() => {
    void Promise.resolve().then(() => loadOverview());
  }, [loadOverview]);

  useEffect(() => {
    if (!canView) return;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadOverview();
      }
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [canView, loadOverview]);

  const filteredWaiting = useMemo(
    () =>
      data?.notBoardedStudents.filter((student) =>
        matchesSearch(
          `${student.name} ${student.registration} ${student.group?.name ?? ""}`,
          waitingSearch,
        ),
      ) ?? [],
    [data, waitingSearch],
  );

  const filteredBoarded = useMemo(
    () =>
      data?.boardedStudents.filter((student) => {
        const matchesName = matchesSearch(
          `${student.name} ${student.registration} ${student.group?.name ?? ""}`,
          boardedSearch,
        );
        const matchesBus =
          busFilter === "all" || student.busFilterKey === busFilter;

        return matchesName && matchesBus;
      }) ?? [],
    [data, boardedSearch, busFilter],
  );

  const boardedLastPage = Math.max(
    1,
    Math.ceil(filteredBoarded.length / BOARDED_PAGE_SIZE),
  );
  // A página é limitada no cálculo em vez de reajustada por efeito: evita um
  // render extra sempre que um filtro muda.
  const currentBoardedPage = Math.min(boardedPage, boardedLastPage);
  const pageStart = (currentBoardedPage - 1) * BOARDED_PAGE_SIZE;
  const paginatedBoarded = filteredBoarded.slice(
    pageStart,
    pageStart + BOARDED_PAGE_SIZE,
  );

  const selectedBusLabel =
    busFilter === "all"
      ? "Todos os ônibus"
      : (data?.busOptions.find((option) => option.value === busFilter)?.label ??
        "Todos os ônibus");

  const columns: Column<BoardedStudent>[] = [
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
      key: "bus",
      header: "Ônibus",
      hideBelow: "sm",
      cell: (student) => (
        <div className="min-w-0">
          <p className="truncate tracking-wide">{student.busPlate}</p>
          <p className="truncate text-xs text-muted-foreground">
            {student.deviceName || student.deviceCode || "UniHub"}
          </p>
        </div>
      ),
    },
    {
      key: "first",
      header: "1º embarque",
      hideBelow: "md",
      cell: (student) => (
        <span className="tabular-nums text-muted-foreground">
          {formatTime(student.firstBoardingAt)}
        </span>
      ),
    },
    {
      key: "second",
      header: "2º embarque",
      cell: (student) => (
        <StatusBadge tone="success">
          {formatTime(student.secondBoardingAt)}
        </StatusBadge>
      ),
    },
    {
      key: "group",
      header: "Grupo",
      hideBelow: "lg",
      cell: (student) =>
        student.group?.name ? (
          <StatusBadge>{student.group.name}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  if (!canView) {
    return (
      <AccessDenied description="Este perfil não pode acessar o painel de embarques." />
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Referência ${formatDateKey(data?.dateKey ?? "")}`}
        title="Retorno do dia"
        description="O 1º embarque é a ida. O 2º embarque do mesmo dia é lido como a volta para casa."
        actions={
          <GhostButton
            onClick={() => void loadOverview()}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
            <span className="tabular-nums text-muted-foreground">
              {formatLastUpdated(data?.generatedAt ?? null)}
            </span>
          </GhostButton>
        }
      />

      {error && (
        <ErrorState message={error} onRetry={() => void loadOverview()} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Com primeiro embarque"
          value={summary?.studentsWithFirstBoarding ?? 0}
          hint="Alunos que já registraram a ida hoje"
          icon={<LogIn size={15} />}
          loading={loading}
        />
        <SummaryCard
          label="Aguardando a volta"
          value={summary?.waitingSecondBoarding ?? 0}
          hint="Com apenas 1 embarque no dia"
          icon={<UserX size={15} />}
          loading={loading}
        />
        <SummaryCard
          label="Embarcaram na volta"
          value={summary?.secondBoardingDone ?? 0}
          hint="Com 2 embarques ou mais no dia"
          icon={<UserCheck size={15} />}
          loading={loading}
        />
        <SummaryCard
          label="Ônibus da volta"
          value={summary?.busesWithSecondBoarding ?? 0}
          hint="Veículos com segundo embarque"
          icon={<Truck size={15} />}
          loading={loading}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Embarcaram na volta
          </h2>
          <span className="text-xs text-muted-foreground">
            {filteredBoarded.length}{" "}
            {filteredBoarded.length === 1 ? "aluno" : "alunos"} com volta
            registrada
          </span>
        </div>

        <Toolbar>
          <SearchField
            value={boardedSearch}
            onChange={(value) => {
              setBoardedSearch(value);
              setBoardedPage(1);
            }}
            placeholder="Buscar por nome ou matrícula..."
          />

          <Select
            value={busFilter}
            onValueChange={(value) => {
              setBusFilter(value ?? "all");
              setBoardedPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-full rounded-xl md:w-56">
              {/* O rótulo vai explícito: sem isso o gatilho mostra o valor cru. */}
              <SelectValue placeholder="Filtrar por ônibus">
                {selectedBusLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os ônibus</SelectItem>
              {(data?.busOptions ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Toolbar>

        <DataTable
          rows={paginatedBoarded}
          columns={columns}
          getRowId={(student) => student.id}
          loading={loading}
          isFetching={refreshing && !loading}
          page={currentBoardedPage}
          lastPage={boardedLastPage}
          total={filteredBoarded.length}
          onPageChange={setBoardedPage}
          skeletonRows={5}
          emptyIcon={<UserCheck size={22} />}
          emptyTitle="Nenhum aluno com a volta registrada"
          emptyDescription={
            boardedSearch || busFilter !== "all"
              ? "Ajuste a busca ou o filtro de ônibus."
              : "Assim que um aluno passar a TAG pela segunda vez hoje, ele aparece aqui."
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Aguardando segundo embarque
          </h2>
          <span className="text-xs text-muted-foreground">
            {filteredWaiting.length}{" "}
            {filteredWaiting.length === 1 ? "aluno" : "alunos"} aguardando
          </span>
        </div>

        <Toolbar>
          <SearchField
            value={waitingSearch}
            onChange={setWaitingSearch}
            placeholder="Buscar por nome ou matrícula..."
          />
        </Toolbar>

        {filteredWaiting.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Clock size={22} />}
              title="Nenhum aluno aguardando a volta"
              description="Quando o primeiro embarque acontecer, o aluno aparece aqui até registrar a volta."
            />
          </Panel>
        ) : (
          <div className="unipass-scrollbar max-h-[34rem] space-y-2 overflow-y-auto pr-1">
            {filteredWaiting.map((student) => (
              <WaitingRow
                key={student.id}
                student={student}
                expanded={expandedId === student.id}
                onToggle={() =>
                  setExpandedId((current) =>
                    current === student.id ? null : student.id,
                  )
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${ACCENT}14`, color: ACCENT }}
        >
          {icon}
        </span>
      </div>

      {loading ? (
        <div className="mt-3 h-8 w-12 animate-pulse rounded-lg bg-accent" />
      ) : (
        <AnimatedNumber
          value={value}
          className="mt-3 block text-3xl font-semibold leading-none tracking-tight"
        />
      )}

      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </Panel>
  );
}

function WaitingRow({
  student,
  expanded,
  onToggle,
}: {
  student: WaitingStudent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const details = [
    { label: "Telefone", value: student.phone || "Não informado" },
    { label: "E-mail", value: student.email || "Não informado" },
    { label: "TAG", value: student.rfidTag || "Não vinculada" },
    { label: "Primeiro ônibus", value: student.firstBusPlate },
    {
      label: "Primeiro UniHub",
      value:
        student.firstDeviceName ||
        student.firstDeviceCode ||
        "Não identificado",
    },
    { label: "Grupo", value: student.group?.name || "Sem grupo vinculado" },
    {
      label: "Rotas",
      value:
        student.routeNames.length > 0
          ? student.routeNames.join(", ")
          : "Sem rota vinculada",
    },
  ];

  return (
    <Panel className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/30"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{student.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            Matrícula {student.registration}
            {student.group ? ` · ${student.group.name}` : ""}
          </p>
        </div>

        <StatusBadge tone="warning">
          1º às {formatTime(student.firstBoardingAt)}
        </StatusBadge>

        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown size={15} />
        </motion.span>
      </button>

      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="overflow-hidden"
      >
        <div className="grid gap-2 border-t border-border/50 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
          {details.map((detail) => (
            <div
              key={detail.label}
              className="rounded-xl bg-accent/40 px-3 py-2"
            >
              <SectionLabel>{detail.label}</SectionLabel>
              <p className="mt-0.5 truncate text-sm" title={detail.value}>
                {detail.value}
              </p>
            </div>
          ))}
        </div>
      </motion.div>
    </Panel>
  );
}
