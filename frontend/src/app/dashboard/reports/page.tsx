"use client";

import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AlertTriangle,
  BarChart3,
  Bus,
  CalendarRange,
  Download,
  FileBarChart2,
  Filter,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Map,
  RefreshCw,
  Search,
  SearchCheck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/app/contexts/AuthContext";
import { PageTableSkeleton } from "@/app/dashboard/components/DashboardSkeletons";
import { AccessDenied } from "@/components/AccessDenied";
import { PageHeader, StatusBadge } from "@/app/dashboard/components/page-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import api from "@/services/api";

type ReportType = "boarding" | "students" | "fleet" | "routes" | "groups";
type EventType = "ALL" | "BOARDING" | "DEBOARDING" | "LEAVING" | "DENIED";
type StudentStatus = "all" | "active" | "inactive";
type ReportCategory = "operacao" | "pessoas";

type FilterOption = {
  value: string;
  label: string;
};

type ReportCard = {
  id: ReportType;
  label: string;
  description: string;
  category: ReportCategory;
};

type ReportResponse = {
  generatedAt: string;
  availableReports: ReportCard[];
  filters: {
    reportType: ReportType;
    startDate: string;
    endDate: string;
    busId: string | null;
    routeId: string | null;
    groupId: string | null;
    eventType: EventType;
    studentStatus: StudentStatus;
  };
  options: {
    buses: FilterOption[];
    routes: FilterOption[];
    groups: FilterOption[];
  };
  report: {
    type: ReportType;
    title: string;
    description: string;
    highlight: string;
    summaryCards: Array<{
      label: string;
      value: string;
      helper: string;
    }>;
    chart: {
      title: string;
      description: string;
      xKey: "date";
      series: Array<{
        key: string;
        label: string;
        color: string;
      }>;
      data: Array<Record<string, string | number>>;
    };
    table: {
      title: string;
      description: string;
      columns: Array<{
        key: string;
        label: string;
      }>;
      rows: Array<{
        id: string;
        values: Record<string, string>;
      }>;
      emptyTitle: string;
      emptyDescription: string;
    };
  };
};

type DraftFilters = {
  reportType: ReportType;
  startDate: string;
  endDate: string;
  busId: string;
  routeId: string;
  groupId: string;
  eventType: EventType;
  studentStatus: StudentStatus;
};

const QUICK_RANGES = [
  { label: "Hoje", days: 1 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

const EVENT_TYPE_LABELS: Array<{ value: EventType; label: string }> = [
  { value: "ALL", label: "Todos os eventos" },
  { value: "BOARDING", label: "Boardings" },
  { value: "DEBOARDING", label: "Desembarques" },
  { value: "LEAVING", label: "Saidas" },
  { value: "DENIED", label: "Negados" },
];

const STUDENT_STATUS_LABELS: Array<{ value: StudentStatus; label: string }> = [
  { value: "all", label: "Todos os status" },
  { value: "active", label: "Somente ativos" },
  { value: "inactive", label: "Somente inativos" },
];

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  operacao: "Operação",
  pessoas: "Pessoas",
};

const REPORT_TYPE_FILTERS: Record<
  ReportType,
  {
    eventType: boolean;
    studentStatus: boolean;
  }
> = {
  boarding: { eventType: true, studentStatus: false },
  students: { eventType: false, studentStatus: true },
  fleet: { eventType: false, studentStatus: false },
  routes: { eventType: false, studentStatus: true },
  groups: { eventType: false, studentStatus: true },
};

function getDateKey(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function createDefaultFilters(): DraftFilters {
  return {
    reportType: "boarding",
    startDate: getDateKey(-6),
    endDate: getDateKey(),
    busId: "all",
    routeId: "all",
    groupId: "all",
    eventType: "ALL",
    studentStatus: "all",
  };
}

function normalizeFilters(filters: ReportResponse["filters"]): DraftFilters {
  return {
    reportType: filters.reportType,
    startDate: filters.startDate,
    endDate: filters.endDate,
    busId: filters.busId ?? "all",
    routeId: filters.routeId ?? "all",
    groupId: filters.groupId ?? "all",
    eventType: filters.eventType,
    studentStatus: filters.studentStatus,
  };
}

function formatAxisDate(value: string) {
  if (!value) {
    return "--/--";
  }

  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function formatGeneratedAt(value?: string) {
  if (!value) {
    return "Atualizando...";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function getReportVisuals(reportType: ReportType) {
  switch (reportType) {
    case "students":
      return {
        icon: <GraduationCap className="size-5" />,
        iconWrap: "bg-[#fff1e8] text-[#ff5c00] dark:bg-[#3a2618] dark:text-[#ffb07a]",
        glow: "from-[#fff7ef] via-[#fffaf7] to-white dark:from-[#2a1f1a] dark:via-[#1f1c1a] dark:to-[#171717]",
        badge: "bg-[#ff5c00] text-white",
      };
    case "fleet":
      return {
        icon: <Bus className="size-5" />,
        iconWrap: "bg-[#fff0e8] text-[#d9480f] dark:bg-[#37241b] dark:text-[#ffb784]",
        glow: "from-[#fff6ef] via-[#fffbf8] to-white dark:from-[#261d18] dark:via-[#1d1a18] dark:to-[#171717]",
        badge: "bg-[#f97316] text-white",
      };
    case "routes":
      return {
        icon: <Map className="size-5" />,
        iconWrap: "bg-[#fff3e9] text-[#ea580c] dark:bg-[#35241d] dark:text-[#ffb989]",
        glow: "from-[#fff8f2] via-[#fffdfb] to-white dark:from-[#281f1b] dark:via-[#1d1b1a] dark:to-[#171717]",
        badge: "bg-[#ea580c] text-white",
      };
    case "groups":
      return {
        icon: <Layers3 className="size-5" />,
        iconWrap: "bg-[#fff3ea] text-[#c2410c] dark:bg-[#33231d] dark:text-[#ffb489]",
        glow: "from-[#fff8f3] via-[#fffefc] to-white dark:from-[#281f1c] dark:via-[#1d1b1a] dark:to-[#171717]",
        badge: "bg-[#c2410c] text-white",
      };
    default:
      return {
        icon: <BarChart3 className="size-5" />,
        iconWrap: "bg-[#fff0e6] text-[#ff5c00] dark:bg-[#3a2618] dark:text-[#ffb07a]",
        glow: "from-[#fff4ec] via-[#fffaf6] to-white dark:from-[#2a1f1a] dark:via-[#1f1c1a] dark:to-[#171717]",
        badge: "bg-[#ff5c00] text-white",
      };
  }
}

function getReportSelectionNote(reportType: ReportType) {
  switch (reportType) {
    case "students":
      return "Melhor para identificar frequencia, ausencias e recorrencia por aluno.";
    case "fleet":
      return "Melhor para comparar a carga operacional entre os veiculos da frota.";
    case "routes":
      return "Melhor para revisar quais rotas estão realmente sendo utilizadas.";
    case "groups":
      return "Melhor para enxergar concentracao de uso por unidade, turma ou setor.";
    default:
      return "Melhor para auditoria operacional do fluxo de embarques e ocorrencias.";
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function ActiveFilterChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-[#ffd9c2] bg-[#fff6ef] px-3 py-1 text-xs font-medium text-[#9a4b16] dark:border-[#5a3a29] dark:bg-[#2a211d] dark:text-[#f2b78a]">
      {label}
    </span>
  );
}

function hexToRgb(color: string) {
  const normalized = color.replace("#", "");

  if (normalized.length !== 6) {
    return { r: 255, g: 92, b: 0 };
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function drawChartOnPdf(
  pdf: jsPDF,
  chart: ReportResponse["report"]["chart"],
  startY: number,
  marginX: number,
) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const chartWidth = pageWidth - marginX * 2;
  const chartHeight = 170;
  const totalHeight = 235;

  let currentY = startY;

  if (currentY + totalHeight > pageHeight - 40) {
    pdf.addPage();
    currentY = 40;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(chart.title, marginX, currentY);
  currentY += 12;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(110, 110, 110);
  pdf.text(chart.description, marginX, currentY, {
    maxWidth: chartWidth,
  });
  currentY += 24;

  const plotLeft = marginX + 30;
  const plotTop = currentY;
  const plotWidth = chartWidth - 40;
  const plotHeight = chartHeight - 24;
  const plotBottom = plotTop + plotHeight;
  const groupWidth = chart.data.length > 0 ? plotWidth / chart.data.length : plotWidth;
  const maxValue = Math.max(
    1,
    ...chart.data.flatMap((point) =>
      chart.series.map((series) => Number(point[series.key] ?? 0)),
    ),
  );

  pdf.setDrawColor(224, 224, 224);
  pdf.line(plotLeft, plotTop, plotLeft, plotBottom);
  pdf.line(plotLeft, plotBottom, plotLeft + plotWidth, plotBottom);

  pdf.setFontSize(8);
  pdf.setTextColor(130, 130, 130);
  pdf.text(String(maxValue), marginX, plotTop + 3);
  pdf.text("0", marginX + 10, plotBottom);

  chart.data.forEach((point, index) => {
    const safeSeriesCount = Math.max(chart.series.length, 1);
    const innerGap = 8;
    const barAreaWidth = Math.max(groupWidth - innerGap, 8);
    const barWidth = Math.max(
      Math.min((barAreaWidth - (safeSeriesCount - 1) * 4) / safeSeriesCount, 18),
      4,
    );
    const groupLeft = plotLeft + index * groupWidth + innerGap / 2;

    chart.series.forEach((series, seriesIndex) => {
      const value = Number(point[series.key] ?? 0);
      const barHeight = (value / maxValue) * (plotHeight - 8);
      const barX = groupLeft + seriesIndex * (barWidth + 4);
      const barY = plotBottom - barHeight;
      const { r, g, b } = hexToRgb(series.color);

      pdf.setFillColor(r, g, b);
      pdf.roundedRect(barX, barY, barWidth, barHeight, 2, 2, "F");
    });

    pdf.setTextColor(120, 120, 120);
    pdf.text(
      formatAxisDate(String(point[chart.xKey] ?? "")),
      groupLeft,
      plotBottom + 12,
    );
  });

  let legendX = marginX;
  const legendY = plotBottom + 26;

  chart.series.forEach((series) => {
    const { r, g, b } = hexToRgb(series.color);
    pdf.setFillColor(r, g, b);
    pdf.roundedRect(legendX, legendY - 7, 10, 10, 2, 2, "F");
    pdf.setTextColor(80, 80, 80);
    pdf.text(series.label, legendX + 15, legendY + 1);
    legendX += Math.max(90, series.label.length * 6 + 32);
  });

  pdf.setTextColor(0, 0, 0);
  return legendY + 20;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN";

  const [filters, setFilters] = useState<DraftFilters>(() => createDefaultFilters());
  const [catalogSearch, setCatalogSearch] = useState("");
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = data?.report;
  const options = data?.options;
  const availableReports = data?.availableReports ?? [];
  const selectedReportCard =
    availableReports.find((item) => item.id === filters.reportType) ?? null;
  const selectedVisual = getReportVisuals(filters.reportType);
  const selectedFilterConfig = REPORT_TYPE_FILTERS[filters.reportType];

  const filteredCatalog = useMemo(() => {
    const normalizedSearch = catalogSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return availableReports;
    }

    return availableReports.filter((item) =>
      `${item.label} ${item.description} ${CATEGORY_LABELS[item.category]}`
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [availableReports, catalogSearch]);

  const groupedCatalog = useMemo(
    () => ({
      operacao: filteredCatalog.filter((item) => item.category === "operacao"),
      pessoas: filteredCatalog.filter((item) => item.category === "pessoas"),
    }),
    [filteredCatalog],
  );

  async function fetchReport(nextFilters: DraftFilters, mode: "initial" | "refresh") {
    if (!canManage) {
      return;
    }

    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const response = await api.get<ReportResponse>("/dashboard/reports", {
        params: {
          reportType: nextFilters.reportType,
          startDate: nextFilters.startDate,
          endDate: nextFilters.endDate,
          ...(nextFilters.busId !== "all" ? { busId: nextFilters.busId } : {}),
          ...(nextFilters.routeId !== "all" ? { routeId: nextFilters.routeId } : {}),
          ...(nextFilters.groupId !== "all" ? { groupId: nextFilters.groupId } : {}),
          ...(REPORT_TYPE_FILTERS[nextFilters.reportType].eventType &&
          nextFilters.eventType !== "ALL"
            ? { eventType: nextFilters.eventType }
            : {}),
          ...(REPORT_TYPE_FILTERS[nextFilters.reportType].studentStatus &&
          nextFilters.studentStatus !== "all"
            ? { studentStatus: nextFilters.studentStatus }
            : {}),
        },
      });

      setData(response.data);
      setFilters(normalizeFilters(response.data.filters));
      setError(null);
    } catch {
      setError("Não foi possível gerar o relatório com os filtros informados.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void fetchReport(createDefaultFilters(), "initial");
  }, [canManage]);

  if (!canManage) {
    return (
      <AccessDenied description="Somente o administrador da empresa pode acessar a área de relatórios." />
    );
  }

  if (loading) {
    return <PageTableSkeleton showAction={false} />;
  }

  function updateFilter<K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleStartDateChange(value: string) {
    setFilters((current) => ({
      ...current,
      startDate: value,
      endDate: current.endDate < value ? value : current.endDate,
    }));
  }

  function handleEndDateChange(value: string) {
    setFilters((current) => ({
      ...current,
      endDate: value,
      startDate: current.startDate > value ? value : current.startDate,
    }));
  }

  function handleQuickRange(days: number) {
    const nextFilters: DraftFilters = {
      ...filters,
      startDate: getDateKey(-(days - 1)),
      endDate: getDateKey(),
    };

    setFilters(nextFilters);
    void fetchReport(nextFilters, "refresh");
  }

  function handleChangeReportType(reportType: ReportType) {
    const nextFilters: DraftFilters = {
      ...filters,
      reportType,
      eventType: REPORT_TYPE_FILTERS[reportType].eventType ? filters.eventType : "ALL",
      studentStatus: REPORT_TYPE_FILTERS[reportType].studentStatus
        ? filters.studentStatus
        : "all",
    };

    setFilters(nextFilters);
    void fetchReport(nextFilters, "refresh");
  }

  function handleResetFilters() {
    const nextFilters = {
      ...createDefaultFilters(),
      reportType: filters.reportType,
    };

    setFilters(nextFilters);
    void fetchReport(nextFilters, "refresh");
  }

  function getOptionLabel(
    source: FilterOption[] | undefined,
    value: string,
    fallback: string,
  ) {
    if (value === "all") {
      return fallback;
    }

    return source?.find((item) => item.value === value)?.label ?? fallback;
  }

  const selectedBusLabel = getOptionLabel(
    options?.buses,
    filters.busId,
    "Todos os ônibus",
  );
  const selectedRouteLabel = getOptionLabel(
    options?.routes,
    filters.routeId,
    "Todas as rotas",
  );
  const selectedGroupLabel = getOptionLabel(
    options?.groups,
    filters.groupId,
    "Todos os grupos",
  );
  const selectedEventTypeLabel =
    EVENT_TYPE_LABELS.find((item) => item.value === filters.eventType)?.label ??
    "Todos os eventos";
  const selectedStudentStatusLabel =
    STUDENT_STATUS_LABELS.find((item) => item.value === filters.studentStatus)
      ?.label ?? "Todos os status";

  async function handleExportPdf() {
    if (!report || exportingPdf) {
      return;
    }

    try {
      setExportingPdf(true);

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const marginX = 40;
      let cursorY = 42;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.text(report.title, marginX, cursorY);

      cursorY += 18;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(`Gerado em ${formatGeneratedAt(data?.generatedAt)}`, marginX, cursorY);

      cursorY += 14;
      pdf.text(report.highlight, marginX, cursorY);

      cursorY += 20;
      pdf.setFontSize(11);
      pdf.text("Filtros aplicados", marginX, cursorY);
      cursorY += 14;

      const activeFilters = [
        `Período: ${formatDateLabel(filters.startDate)} até ${formatDateLabel(filters.endDate)}`,
        `Ônibus: ${getOptionLabel(options?.buses, filters.busId, "Todos os ônibus")}`,
        `Rota: ${getOptionLabel(options?.routes, filters.routeId, "Todas as rotas")}`,
        `Grupo: ${getOptionLabel(options?.groups, filters.groupId, "Todos os grupos")}`,
        ...(selectedFilterConfig.eventType
          ? [
              `Evento: ${
                EVENT_TYPE_LABELS.find((item) => item.value === filters.eventType)?.label ??
                "Todos os eventos"
              }`,
            ]
          : []),
        ...(selectedFilterConfig.studentStatus
          ? [
              `Status: ${
                STUDENT_STATUS_LABELS.find(
                  (item) => item.value === filters.studentStatus,
                )?.label ?? "Todos os status"
              }`,
            ]
          : []),
      ];

      pdf.setFontSize(9);
      for (const item of activeFilters) {
        pdf.text(`- ${item}`, marginX, cursorY);
        cursorY += 12;
      }

      cursorY += 6;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("Resumo executivo", marginX, cursorY);
      cursorY += 10;

      autoTable(pdf, {
        startY: cursorY,
        theme: "grid",
        head: [["Indicador", "Valor", "Leitura"]],
        body: report.summaryCards.map((item) => [item.label, item.value, item.helper]),
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 9, cellPadding: 6 },
        headStyles: { fillColor: [255, 92, 0] },
      });

      cursorY =
        ((pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
          cursorY) + 22;

      cursorY = drawChartOnPdf(pdf, report.chart, cursorY, marginX);

      autoTable(pdf, {
        startY: cursorY,
        theme: "striped",
        margin: { left: marginX, right: marginX },
        head: [report.table.columns.map((column) => column.label)],
        body: report.table.rows.map((row) =>
          report.table.columns.map((column) => row.values[column.key] ?? "--"),
        ),
        styles: {
          fontSize: 8,
          cellPadding: 5,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: [255, 92, 0],
        },
      });

      pdf.save(`${report.type}-${filters.startDate}-a-${filters.endDate}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administração"
        title="Relatórios"
        description="Operação, alunos, rotas, grupos e frota com filtros por período e exportação em PDF."
        meta={
          data?.generatedAt ? (
            <StatusBadge>Gerado {formatGeneratedAt(data.generatedAt)}</StatusBadge>
          ) : null
        }
      />

      <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-3 text-xl">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-[#fff1e8] text-[#ff5c00] dark:bg-[#3a2618] dark:text-[#ffb07a]">
                <FileBarChart2 className="size-5" />
              </div>
              Catálogo de relatórios
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Buscar relatório..."
                className="h-11 rounded-2xl pl-9"
              />
            </div>

            {(["operacao", "pessoas"] as ReportCategory[]).map((category) => (
              <div key={category} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {CATEGORY_LABELS[category]}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {groupedCatalog[category].length}
                  </span>
                </div>

                <div className="space-y-2">
                  {groupedCatalog[category].map((item) => {
                    const active = item.id === filters.reportType;
                    const visuals = getReportVisuals(item.id);

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleChangeReportType(item.id)}
                        className={cn(
                          "w-full rounded-[24px] border p-4 text-left transition-all",
                          active
                            ? "border-[#ffb48a] bg-[linear-gradient(135deg,#fff6ef_0%,#ffffff_100%)] shadow-[0_16px_40px_rgba(255,92,0,0.12)] dark:border-[#7a4a31] dark:bg-[linear-gradient(135deg,#2a211d_0%,#1f2127_100%)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.24)]"
                            : "border-border/60 bg-background hover:border-[#ffd2b8] hover:bg-[#fffaf7] dark:bg-[#181a20] dark:hover:border-[#5d3b2c] dark:hover:bg-[#211d1b]",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl",
                              visuals.iconWrap,
                            )}
                          >
                            {visuals.icon}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold text-foreground">{item.label}</p>
                              {active && (
                                <span
                                  className={cn(
                                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                                    visuals.badge,
                                  )}
                                >
                                  Selecionado
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm leading-5 text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {groupedCatalog[category].length === 0 && (
                    <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                      Nenhum relatório encontrado nessa categoria.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card
            className={cn(
              "rounded-[30px] border-[#ffd8c3] bg-gradient-to-br shadow-[0_24px_60px_rgba(255,92,0,0.08)] dark:border-[#4f3124] dark:shadow-[0_24px_60px_rgba(0,0,0,0.28)]",
              selectedVisual.glow,
            )}
          >
            <CardContent className="pt-0">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-12 items-center justify-center rounded-2xl",
                        selectedVisual.iconWrap,
                      )}
                    >
                      {selectedVisual.icon}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff5c00] dark:text-[#ffb07a]">
                        {selectedReportCard
                          ? CATEGORY_LABELS[selectedReportCard.category]
                          : "Relatório"}
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                        {selectedReportCard?.label ?? report?.title}
                      </h2>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    {selectedReportCard?.description ?? report?.description}
                  </p>

                  <div className="mt-4 inline-flex rounded-full border border-[#ffd6c0] bg-white/80 px-4 py-2 text-sm text-foreground dark:border-[#5a3a29] dark:bg-[#241f1d]/85 dark:text-[#f0ece8]">
                    {getReportSelectionNote(filters.reportType)}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void fetchReport(filters, "refresh")}
                    disabled={refreshing}
                    className="h-11 rounded-2xl border-white/80 bg-white/85 dark:border-white/10 dark:bg-[#222222]/85"
                  >
                    <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                    Atualizar
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleExportPdf()}
                    disabled={!report || exportingPdf}
                    className="h-11 rounded-2xl bg-[#ff5c00] px-5 text-white hover:bg-[#eb5600]"
                  >
                    {exportingPdf ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    Exportar PDF
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-[#fff1e8] text-[#ff5c00] dark:bg-[#3a2618] dark:text-[#ffb07a]">
                  <Filter className="size-5" />
                </div>
                Filtros e período
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_RANGES.map((range) => (
                  <Button
                    key={range.days}
                    type="button"
                    variant="outline"
                    onClick={() => handleQuickRange(range.days)}
                    className="rounded-2xl"
                  >
                    <CalendarRange className="size-4" />
                    {range.label}
                  </Button>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Data inicial">
                  <DatePicker
                    value={filters.startDate}
                    max={filters.endDate}
                    onChange={handleStartDateChange}
                    placeholder="Selecione a data inicial"
                  />
                </Field>

                <Field label="Data final">
                  <DatePicker
                    value={filters.endDate}
                    min={filters.startDate}
                    onChange={handleEndDateChange}
                    placeholder="Selecione a data final"
                  />
                </Field>

                <Field label="Ônibus">
                  <Select
                    value={filters.busId}
                    onValueChange={(value) => updateFilter("busId", value ?? "all")}
                  >
                    <SelectTrigger className="h-11 w-full rounded-2xl">
                      <SelectValue placeholder="Todos os ônibus">
                        {selectedBusLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os ônibus</SelectItem>
                      {(options?.buses ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Rota">
                  <Select
                    value={filters.routeId}
                    onValueChange={(value) => updateFilter("routeId", value ?? "all")}
                  >
                    <SelectTrigger className="h-11 w-full rounded-2xl">
                      <SelectValue placeholder="Todas as rotas">
                        {selectedRouteLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as rotas</SelectItem>
                      {(options?.routes ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Grupo">
                  <Select
                    value={filters.groupId}
                    onValueChange={(value) => updateFilter("groupId", value ?? "all")}
                  >
                    <SelectTrigger className="h-11 w-full rounded-2xl">
                      <SelectValue placeholder="Todos os grupos">
                        {selectedGroupLabel}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os grupos</SelectItem>
                      {(options?.groups ?? []).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {selectedFilterConfig.eventType && (
                  <Field label="Tipo de evento">
                    <Select
                      value={filters.eventType}
                      onValueChange={(value) =>
                        updateFilter("eventType", (value ?? "ALL") as EventType)
                      }
                    >
                      <SelectTrigger className="h-11 w-full rounded-2xl">
                        <SelectValue placeholder="Todos os eventos">
                          {selectedEventTypeLabel}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPE_LABELS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                {selectedFilterConfig.studentStatus && (
                  <Field label="Status do aluno">
                    <Select
                      value={filters.studentStatus}
                      onValueChange={(value) =>
                        updateFilter("studentStatus", (value ?? "all") as StudentStatus)
                      }
                    >
                      <SelectTrigger className="h-11 w-full rounded-2xl">
                        <SelectValue placeholder="Todos os status">
                          {selectedStudentStatusLabel}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STUDENT_STATUS_LABELS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <ActiveFilterChip
                  label={`Período ${formatDateLabel(filters.startDate)} até ${formatDateLabel(filters.endDate)}`}
                />
                {filters.busId !== "all" && (
                  <ActiveFilterChip
                    label={getOptionLabel(options?.buses, filters.busId, "Ônibus")}
                  />
                )}
                {filters.routeId !== "all" && (
                  <ActiveFilterChip
                    label={getOptionLabel(options?.routes, filters.routeId, "Rota")}
                  />
                )}
                {filters.groupId !== "all" && (
                  <ActiveFilterChip
                    label={getOptionLabel(options?.groups, filters.groupId, "Grupo")}
                  />
                )}
                {selectedFilterConfig.eventType && filters.eventType !== "ALL" && (
                  <ActiveFilterChip
                    label={
                      EVENT_TYPE_LABELS.find((item) => item.value === filters.eventType)
                        ?.label ?? "Evento"
                    }
                  />
                )}
                {selectedFilterConfig.studentStatus &&
                  filters.studentStatus !== "all" && (
                    <ActiveFilterChip
                      label={
                        STUDENT_STATUS_LABELS.find(
                          (item) => item.value === filters.studentStatus,
                        )?.label ?? "Status"
                      }
                    />
                  )}
              </div>

              <div className="flex flex-col gap-3 border-t border-black/6 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  A geração cruza os filtros com o relatório selecionado e prepara o
                  mesmo conteúdo para consulta na tela e exportação em PDF.
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleResetFilters}
                    className="h-11 rounded-2xl"
                  >
                    Limpar filtros
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void fetchReport(filters, "refresh")}
                    disabled={refreshing}
                    className="h-11 rounded-2xl bg-[#ff5c00] px-5 text-white hover:bg-[#eb5600]"
                  >
                    {refreshing ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <SearchCheck className="size-4" />
                    )}
                    Gerar relatório
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {error && (
        <Card className="border-amber-300/60 bg-amber-50/80 py-4">
          <CardContent className="flex items-start gap-3 pt-0 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {report.summaryCards.map((item) => (
              <Card
                key={item.label}
                className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl"
              >
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
                    {item.value}
                  </p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    {item.helper}
                  </p>
                </CardContent>
              </Card>
            ))}
          </section>

          <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl">
            <CardHeader className="pb-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff5c00] dark:text-[#ffb07a]">
                  {report.highlight}
                </p>
                <CardTitle className="text-2xl">{report.title}</CardTitle>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {report.description}
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border/50 bg-background/50 p-4">
                <div className="flex flex-col gap-1 pb-4">
                  <p className="text-base font-semibold text-foreground">
                    {report.chart.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {report.chart.description}
                  </p>
                </div>

                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.chart.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#efe8e1" />
                      <XAxis
                        dataKey={report.chart.xKey}
                        tickFormatter={(value) => formatAxisDate(String(value))}
                        tick={{ fill: "#8b8b85", fontSize: 12 }}
                        axisLine={{ stroke: "#e7ddd6" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#8b8b85", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value, name) => [String(value ?? 0), String(name)]}
                        labelFormatter={(value) => `Dia ${formatAxisDate(String(value))}`}
                        contentStyle={{
                          borderRadius: 18,
                          border: "1px solid #f0e3d8",
                          backgroundColor: "#fffaf6",
                        }}
                      />
                      {report.chart.series.map((series) => (
                        <Bar
                          key={series.key}
                          dataKey={series.key}
                          name={series.label}
                          fill={series.color}
                          radius={[10, 10, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border border-border/60 bg-card/70 backdrop-blur-xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">{report.table.title}</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                {report.table.description}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-[22px] border border-[#f1ede8] bg-[#fcfbf9] px-4 py-3 dark:border-white/10 dark:bg-[#17191f]">
                <p className="text-sm text-muted-foreground">
                  {report.table.rows.length} linha(s) retornadas
                </p>
                <FileBarChart2 className="size-4 text-[#ff5c00] dark:text-[#ffb07a]" />
              </div>

              {report.table.rows.length > 0 ? (
                <div className="overflow-hidden rounded-[24px] border border-border/60">
                  <div className="max-h-[34rem] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {report.table.columns.map((column) => (
                            <TableHead key={column.key}>{column.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.table.rows.map((row) => (
                          <TableRow key={row.id}>
                            {report.table.columns.map((column) => (
                              <TableCell key={`${row.id}-${column.key}`}>
                                {row.values[column.key] ?? "--"}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 px-4 py-10 text-center">
                  <p className="text-base font-semibold">{report.table.emptyTitle}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {report.table.emptyDescription}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
