import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventType, Prisma, ScheduleType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLOSED_CHARGE_STATUSES,
  buildOverdueChargeWhere,
} from '../billing/billing-charge-status.util';
import {
  addDaysToDateKey,
  getAppTimeZone,
  getZonedDateParts,
} from '../notifications/notification-time.util';
import {
  GetDashboardReportDto,
  type DashboardReportEventType,
  type DashboardReportStudentStatus,
  type DashboardReportType,
} from './dto/get-dashboard-report.dto';

type ReportFilterOption = {
  value: string;
  label: string;
};

type DashboardReportFilters = {
  reportType: DashboardReportType;
  startDate: string;
  endDate: string;
  busId: string | null;
  routeId: string | null;
  groupId: string | null;
  eventType: DashboardReportEventType;
  studentStatus: DashboardReportStudentStatus;
};

type DashboardReportCard = {
  id: DashboardReportType;
  label: string;
  description: string;
  category: 'operacao' | 'pessoas';
};

type DashboardSummaryCard = {
  label: string;
  value: string;
  helper: string;
};

type DashboardChartSeries = {
  key: string;
  label: string;
  color: string;
};

type DashboardChartDataPoint = {
  date: string;
} & Record<string, number | string>;

type DashboardReportTable = {
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

type DashboardReportPayload = {
  type: DashboardReportType;
  title: string;
  description: string;
  highlight: string;
  summaryCards: DashboardSummaryCard[];
  chart: {
    title: string;
    description: string;
    xKey: 'date';
    series: DashboardChartSeries[];
    data: DashboardChartDataPoint[];
  };
  table: DashboardReportTable;
};

type DashboardReportResponse = {
  generatedAt: string;
  availableReports: DashboardReportCard[];
  filters: DashboardReportFilters;
  options: {
    buses: ReportFilterOption[];
    routes: ReportFilterOption[];
    groups: ReportFilterOption[];
  };
  report: DashboardReportPayload;
};

const METRICS_SERIES_DAYS = 7;
const METRICS_RECENT_EVENTS = 12;
const METRICS_UPCOMING_SCHEDULES = 6;
const DEVICE_ONLINE_THRESHOLD_MS = 45_000;

type MetricsDayBucket = {
  boardings: number;
  deboardings: number;
  denied: number;
  students: Set<string>;
};

function createEmptyBucket(): MetricsDayBucket {
  return {
    boardings: 0,
    deboardings: 0,
    denied: 0,
    students: new Set<string>(),
  };
}

function formatMinutesOfDay(minutesOfDay: number) {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatCents(amountCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountCents / 100);
}

export type DashboardMetricDelta = {
  value: number;
  previous: number;
  delta: number;
  trend: 'up' | 'down' | 'flat';
};

export type DashboardAlert = {
  key: string;
  level: 'info' | 'warning' | 'danger';
  title: string;
  description: string;
  href: string;
};

export type DashboardBillingSnapshot = {
  openCount: number;
  openAmountCents: number;
  overdueCount: number;
  overdueAmountCents: number;
  paidThisMonthCount: number;
  paidThisMonthAmountCents: number;
};

export type DashboardLiveDevice = {
  deviceId: string;
  name: string | null;
  code: string | null;
  busPlate: string | null;
  lastUpdate: string | null;
  online: boolean;
};

export type DashboardUpcomingSchedule = {
  scheduleId: string;
  routeName: string;
  title: string | null;
  type: ScheduleType;
  departureMinutes: number;
  departureLabel: string;
  minutesUntil: number;
  busPlate: string | null;
  studentsCount: number;
};

export type DashboardRecentEvent = {
  eventId: string;
  type: EventType;
  at: string;
  studentName: string | null;
  rfidTag: string | null;
  busPlate: string | null;
  deviceLabel: string | null;
};

export type DashboardSeriesPoint = {
  date: string;
  boardings: number;
  deboardings: number;
  denied: number;
  students: number;
};

export type DashboardMetricsResponse = {
  generatedAt: string;
  dateKey: string;
  timeZone: string;
  students: {
    active: number;
    createdToday: number;
    transportedToday: number;
    transportedYesterday: number;
  };
  movement: {
    boardings: DashboardMetricDelta;
    deboardings: DashboardMetricDelta;
    denied: DashboardMetricDelta;
    transported: DashboardMetricDelta;
    onBoardNow: number;
  };
  fleet: {
    buses: number;
    busesWithoutDevice: number;
    capacityTotal: number;
    occupancyRate: number | null;
    devices: number;
    devicesOnline: number;
    liveDevices: DashboardLiveDevice[];
  };
  schedules: {
    totalToday: number;
    completed: number;
    upcoming: DashboardUpcomingSchedule[];
  };
  confirmations: {
    prompts: {
      pending: number;
      dispatched: number;
      answered: number;
      expired: number;
      failed: number;
    };
    willGo: number;
    willNotGo: number;
  };
  billing: DashboardBillingSnapshot | null;
  series: DashboardSeriesPoint[];
  recentEvents: DashboardRecentEvent[];
  alerts: DashboardAlert[];
};

const AVAILABLE_REPORTS: DashboardReportCard[] = [
  {
    id: 'boarding',
    label: 'Movimentacao',
    description:
      'Concentra embarques, desembarques e eventos negados para acompanhar o fluxo diário.',
    category: 'operacao',
  },
  {
    id: 'students',
    label: 'Frequencia dos alunos',
    description:
      'Resume presenca por aluno, dias com uso e o ultimo movimento registrado.',
    category: 'pessoas',
  },
  {
    id: 'fleet',
    label: 'Frota e operação',
    description:
      'Mostra o uso dos ônibus, viagens registradas, dispositivos e volume de passageiros.',
    category: 'operacao',
  },
  {
    id: 'routes',
    label: 'Rotas',
    description:
      'Acompanha alunos vinculados, uso por rota e quais itinerários tiveram movimentação no período.',
    category: 'operacao',
  },
  {
    id: 'groups',
    label: 'Grupos',
    description:
      'Compara os grupos cadastrados pela empresa e identifica quais tiveram mais uso no transporte.',
    category: 'pessoas',
  },
];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getMetrics(
    companyId: string,
    role?: string,
  ): Promise<DashboardMetricsResponse> {
    const timeZone = this.getTimeZone();
    const now = new Date();
    const todayParts = getZonedDateParts(now, timeZone);
    const todayKey = todayParts.dateKey;
    const yesterdayKey = addDaysToDateKey(todayKey, -1);
    const seriesStartKey = addDaysToDateKey(
      todayKey,
      -(METRICS_SERIES_DAYS - 1),
    );

    const todayStart = this.parseDateKey(todayKey, false);
    const todayEnd = this.parseDateKey(todayKey, true);
    const seriesStart = this.parseDateKey(seriesStartKey, false);

    const [
      activeStudents,
      studentsCreatedToday,
      windowEvents,
      buses,
      devices,
      schedules,
      promptGroups,
      confirmationGroups,
      recentEvents,
    ] = await Promise.all([
      this.prisma.student.count({ where: { companyId, active: true } }),
      this.prisma.student.count({
        where: { companyId, active: true, createdAt: { gte: todayStart } },
      }),
      // Uma única leitura da janela de 7 dias alimenta os KPIs de hoje, a
      // comparação com ontem e a série do gráfico.
      this.prisma.transportEvent.findMany({
        where: { companyId, createdAt: { gte: seriesStart, lte: todayEnd } },
        select: { type: true, createdAt: true, studentId: true },
      }),
      this.prisma.bus.findMany({
        where: { companyId },
        select: { id: true, plate: true, capacity: true },
      }),
      this.prisma.device.findMany({
        where: { companyId, active: true },
        select: {
          id: true,
          name: true,
          code: true,
          busId: true,
          lastUpdate: true,
          bus: { select: { plate: true } },
        },
      }),
      this.prisma.routeSchedule.findMany({
        where: {
          active: true,
          dayOfWeeks: { has: todayParts.dayOfWeek },
          route: { companyId, active: true },
        },
        orderBy: { departureMinutes: 'asc' },
        select: {
          id: true,
          type: true,
          title: true,
          departureMinutes: true,
          bus: { select: { plate: true } },
          route: {
            select: {
              name: true,
              _count: { select: { students: true } },
            },
          },
        },
      }),
      this.prisma.notificationPrompt.groupBy({
        by: ['status'],
        where: {
          occurrenceKey: todayKey,
          schedule: { route: { companyId } },
        },
        _count: { _all: true },
      }),
      this.prisma.scheduleConfirmation.groupBy({
        by: ['willGo'],
        where: {
          occurrenceKey: todayKey,
          schedule: { route: { companyId } },
        },
        _count: { _all: true },
      }),
      this.prisma.transportEvent.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: METRICS_RECENT_EVENTS,
        select: {
          id: true,
          type: true,
          createdAt: true,
          student: { select: { name: true } },
          rfidCard: { select: { tag: true } },
          device: {
            select: {
              name: true,
              code: true,
              bus: { select: { plate: true } },
            },
          },
        },
      }),
    ]);

    const series = this.buildMetricsSeries(
      windowEvents,
      seriesStartKey,
      todayKey,
      timeZone,
    );

    const todayBucket = series.buckets.get(todayKey) ?? createEmptyBucket();
    const yesterdayBucket =
      series.buckets.get(yesterdayKey) ?? createEmptyBucket();

    const capacityTotal = buses.reduce((acc, bus) => acc + bus.capacity, 0);
    const onlineThreshold = now.getTime() - DEVICE_ONLINE_THRESHOLD_MS;
    const isDeviceOnline = (lastUpdate: Date | null) =>
      lastUpdate !== null && lastUpdate.getTime() >= onlineThreshold;

    const devicesOnline = devices.filter((device) =>
      isDeviceOnline(device.lastUpdate),
    );

    const linkedBusIds = new Set(
      devices
        .map((device) => device.busId)
        .filter((busId): busId is string => Boolean(busId)),
    );
    const busesWithoutDevice = buses.filter((bus) => !linkedBusIds.has(bus.id));

    const promptCounts = {
      pending: 0,
      dispatched: 0,
      answered: 0,
      expired: 0,
      failed: 0,
    };

    for (const group of promptGroups) {
      const key = group.status.toLowerCase() as keyof typeof promptCounts;

      if (key in promptCounts) {
        promptCounts[key] = group._count._all;
      }
    }

    let willGo = 0;
    let willNotGo = 0;

    for (const group of confirmationGroups) {
      if (group.willGo) {
        willGo = group._count._all;
      } else {
        willNotGo = group._count._all;
      }
    }

    const upcoming = schedules.filter(
      (schedule) => schedule.departureMinutes >= todayParts.minutesOfDay,
    );

    const billing =
      role === 'ADMIN' ? await this.getBillingSnapshot(companyId, now) : null;

    const metrics: DashboardMetricsResponse = {
      generatedAt: now.toISOString(),
      dateKey: todayKey,
      timeZone,
      students: {
        active: activeStudents,
        createdToday: studentsCreatedToday,
        transportedToday: todayBucket.students.size,
        transportedYesterday: yesterdayBucket.students.size,
      },
      movement: {
        boardings: this.buildDelta(
          todayBucket.boardings,
          yesterdayBucket.boardings,
        ),
        deboardings: this.buildDelta(
          todayBucket.deboardings,
          yesterdayBucket.deboardings,
        ),
        denied: this.buildDelta(todayBucket.denied, yesterdayBucket.denied),
        transported: this.buildDelta(
          todayBucket.students.size,
          yesterdayBucket.students.size,
        ),
        onBoardNow: Math.max(todayBucket.boardings - todayBucket.deboardings, 0),
      },
      fleet: {
        buses: buses.length,
        busesWithoutDevice: busesWithoutDevice.length,
        capacityTotal,
        occupancyRate:
          capacityTotal > 0
            ? Math.round((todayBucket.boardings / capacityTotal) * 100)
            : null,
        devices: devices.length,
        devicesOnline: devicesOnline.length,
        liveDevices: devices
          .filter((device) => device.busId)
          .map((device) => ({
            deviceId: device.id,
            name: device.name,
            code: device.code,
            busPlate: device.bus?.plate ?? null,
            lastUpdate: device.lastUpdate?.toISOString() ?? null,
            online: isDeviceOnline(device.lastUpdate),
          })),
      },
      schedules: {
        totalToday: schedules.length,
        completed: schedules.length - upcoming.length,
        upcoming: upcoming
          .slice(0, METRICS_UPCOMING_SCHEDULES)
          .map((schedule) => ({
            scheduleId: schedule.id,
            routeName: schedule.route.name,
            title: schedule.title,
            type: schedule.type,
            departureMinutes: schedule.departureMinutes,
            departureLabel: formatMinutesOfDay(schedule.departureMinutes),
            minutesUntil: schedule.departureMinutes - todayParts.minutesOfDay,
            busPlate: schedule.bus?.plate ?? null,
            studentsCount: schedule.route._count.students,
          })),
      },
      confirmations: {
        prompts: promptCounts,
        willGo,
        willNotGo,
      },
      billing,
      series: series.data,
      recentEvents: recentEvents.map((event) => ({
        eventId: event.id,
        type: event.type,
        at: event.createdAt.toISOString(),
        studentName: event.student?.name ?? null,
        rfidTag: event.rfidCard?.tag ?? null,
        busPlate: event.device.bus?.plate ?? null,
        deviceLabel: event.device.name ?? event.device.code ?? null,
      })),
      alerts: [],
    };

    metrics.alerts = this.buildMetricsAlerts(metrics);

    return metrics;
  }

  private buildDelta(current: number, previous: number): DashboardMetricDelta {
    return {
      value: current,
      previous,
      delta: current - previous,
      trend: current === previous ? 'flat' : current > previous ? 'up' : 'down',
    };
  }

  private buildMetricsSeries(
    events: Array<{
      type: EventType;
      createdAt: Date;
      studentId: string | null;
    }>,
    startKey: string,
    endKey: string,
    timeZone: string,
  ) {
    const buckets = new Map<string, MetricsDayBucket>();

    let cursor = startKey;

    while (cursor <= endKey) {
      buckets.set(cursor, createEmptyBucket());
      cursor = addDaysToDateKey(cursor, 1);
    }

    for (const event of events) {
      const dateKey = getZonedDateParts(event.createdAt, timeZone).dateKey;
      const bucket = buckets.get(dateKey);

      if (!bucket) {
        continue;
      }

      if (event.type === 'BOARDING') {
        bucket.boardings += 1;

        if (event.studentId) {
          bucket.students.add(event.studentId);
        }
      } else if (event.type === 'DEBOARDING') {
        bucket.deboardings += 1;
      } else if (event.type === 'DENIED') {
        bucket.denied += 1;
      }
    }

    const data = Array.from(buckets.entries()).map(([date, bucket]) => ({
      date,
      boardings: bucket.boardings,
      deboardings: bucket.deboardings,
      denied: bucket.denied,
      students: bucket.students.size,
    }));

    return { buckets, data };
  }

  private async getBillingSnapshot(
    companyId: string,
    now: Date,
  ): Promise<DashboardBillingSnapshot> {
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    // As regras vêm do módulo financeiro para que o painel e a tela de boletos
    // nunca mostrem contagens diferentes da mesma coisa.
    const overdueWhere = buildOverdueChargeWhere(now);

    const [openCharges, overdueCharges, paidCharges] = await Promise.all([
      this.prisma.billingCharge.aggregate({
        where: {
          companyId,
          status: { notIn: [...CLOSED_CHARGE_STATUSES] },
          NOT: overdueWhere,
        },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.prisma.billingCharge.aggregate({
        where: { companyId, ...overdueWhere },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      this.prisma.billingCharge.aggregate({
        where: { companyId, status: 'PAID', paidAt: { gte: monthStart } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
    ]);

    return {
      openCount: openCharges._count._all,
      openAmountCents: openCharges._sum.amountCents ?? 0,
      overdueCount: overdueCharges._count._all,
      overdueAmountCents: overdueCharges._sum.amountCents ?? 0,
      paidThisMonthCount: paidCharges._count._all,
      paidThisMonthAmountCents: paidCharges._sum.amountCents ?? 0,
    };
  }

  private buildMetricsAlerts(
    metrics: DashboardMetricsResponse,
  ): DashboardAlert[] {
    const alerts: DashboardAlert[] = [];

    const offlineDevices = metrics.fleet.liveDevices.filter(
      (device) => !device.online,
    );

    if (offlineDevices.length > 0) {
      alerts.push({
        key: 'devices-offline',
        level: 'warning',
        title:
          offlineDevices.length === 1
            ? '1 UniHub sem sinal'
            : `${offlineDevices.length} UniHubs sem sinal`,
        description:
          'Dispositivos vinculados a um ônibus que não enviam telemetria há mais de 45 segundos.',
        href: '/dashboard/location',
      });
    }

    if (metrics.fleet.busesWithoutDevice > 0) {
      alerts.push({
        key: 'buses-without-device',
        level: 'info',
        title:
          metrics.fleet.busesWithoutDevice === 1
            ? '1 ônibus sem UniHub'
            : `${metrics.fleet.busesWithoutDevice} ônibus sem UniHub`,
        description:
          'Sem dispositivo pareado não há leitura de TAG nem rastreamento nesses veículos.',
        href: '/dashboard/devices',
      });
    }

    if (metrics.movement.denied.value > 0) {
      alerts.push({
        key: 'denied-events',
        level: 'warning',
        title:
          metrics.movement.denied.value === 1
            ? '1 leitura negada hoje'
            : `${metrics.movement.denied.value} leituras negadas hoje`,
        description:
          'TAG desconhecida, aluno inativo ou embarque duplicado. Vale conferir os cadastros.',
        href: '/dashboard/boarding',
      });
    }

    if (metrics.confirmations.prompts.failed > 0) {
      alerts.push({
        key: 'prompts-failed',
        level: 'danger',
        title: `${metrics.confirmations.prompts.failed} notificações falharam`,
        description:
          'Os avisos de horário não chegaram nesses responsáveis hoje.',
        href: '/dashboard/app',
      });
    }

    if (metrics.billing && metrics.billing.overdueCount > 0) {
      alerts.push({
        key: 'billing-overdue',
        level: 'danger',
        title: `${metrics.billing.overdueCount} boletos vencidos`,
        description: `Total de ${formatCents(metrics.billing.overdueAmountCents)} em aberto após o vencimento.`,
        href: '/dashboard/billing',
      });
    }

    return alerts;
  }

  async getReport(
    companyId: string,
    query: GetDashboardReportDto,
  ): Promise<DashboardReportResponse> {
    const filters = this.normalizeReportFilters(query);

    const [options, report] = await Promise.all([
      this.getReportOptions(companyId),
      this.buildReport(companyId, filters),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      availableReports: AVAILABLE_REPORTS,
      filters,
      options,
      report,
    };
  }

  private async buildReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    if (filters.reportType === 'routes') {
      return this.buildRoutesReport(companyId, filters);
    }

    if (filters.reportType === 'groups') {
      return this.buildGroupsReport(companyId, filters);
    }

    if (filters.reportType === 'students') {
      return this.buildStudentsReport(companyId, filters);
    }

    if (filters.reportType === 'fleet') {
      return this.buildFleetReport(companyId, filters);
    }

    return this.buildBoardingReport(companyId, filters);
  }

  private async buildBoardingReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    const eventWhere: Prisma.TransportEventWhereInput = {
      companyId,
      createdAt: this.buildDateRange(filters.startDate, filters.endDate),
      ...(filters.busId ? { device: { busId: filters.busId } } : {}),
      ...(filters.eventType !== 'ALL' ? { type: filters.eventType } : {}),
      ...this.buildTransportEventStudentScope(filters),
    };

    const events = await this.prisma.transportEvent.findMany({
      where: eventWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        createdAt: true,
        rfidCard: {
          select: {
            tag: true,
          },
        },
        student: {
          select: {
            id: true,
            name: true,
            registration: true,
            group: {
              select: {
                name: true,
              },
            },
            routes: {
              select: {
                route: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
        device: {
          select: {
            name: true,
            code: true,
            bus: {
              select: {
                plate: true,
              },
            },
          },
        },
      },
    });

    const chart = this.createDailyChartData(filters.startDate, filters.endDate, {
      boardings: 0,
      deboardings: 0,
      denied: 0,
    });

    let boardings = 0;
    let deboardings = 0;
    let denied = 0;
    const uniqueStudents = new Set<string>();

    for (const event of events) {
      const dateKey = this.getDateKey(event.createdAt);
      const bucket = chart.index.get(dateKey);

      if (event.student?.id) {
        uniqueStudents.add(event.student.id);
      }

      if (event.type === 'BOARDING') {
        boardings += 1;
        bucket && (bucket.boardings += 1);
      } else if (event.type === 'DEBOARDING') {
        deboardings += 1;
        bucket && (bucket.deboardings += 1);
      } else if (event.type === 'DENIED') {
        denied += 1;
        bucket && (bucket.denied += 1);
      }
    }

    return {
      type: 'boarding',
      title: 'Relatório de movimentação',
      description:
        'Mostra os eventos operacionais do período com foco em embarques, desembarques e recusas.',
      highlight: this.formatPeriodLabel(filters.startDate, filters.endDate),
      summaryCards: [
        {
          label: 'Eventos no período',
          value: this.formatCount(events.length),
          helper: 'Soma de embarques, desembarques e negados.',
        },
        {
          label: 'Boardings',
          value: this.formatCount(boardings),
          helper: 'Registros autorizados de entrada.',
        },
        {
          label: 'Desembarques',
          value: this.formatCount(deboardings),
          helper: 'Saídas registradas no mesmo período.',
        },
        {
          label: 'Alunos unicos',
          value: this.formatCount(uniqueStudents.size),
          helper: 'Quantidade de alunos diferentes com evento.',
        },
      ],
      chart: {
        title: 'Volume por dia',
        description:
          'Distribuição diária para comparar o comportamento da operação no período filtrado.',
        xKey: 'date',
        series: [
          { key: 'boardings', label: 'Boardings', color: '#ff8a4c' },
          { key: 'deboardings', label: 'Desembarques', color: '#f97316' },
          { key: 'denied', label: 'Negados', color: '#7c2d12' },
        ],
        data: chart.data,
      },
      table: {
        title: 'Eventos detalhados',
        description:
          'Lista cronologica reversa para auditoria operacional e conferencia pontual.',
        columns: [
          { key: 'datetime', label: 'Data e hora' },
          { key: 'type', label: 'Tipo' },
          { key: 'student', label: 'Aluno' },
          { key: 'group', label: 'Grupo' },
          { key: 'routes', label: 'Rotas' },
          { key: 'bus', label: 'Ônibus' },
          { key: 'device', label: 'UniHub' },
        ],
        rows: events.map((event) => ({
          id: event.id,
          values: {
            datetime: this.formatDateTime(event.createdAt),
            type: this.formatEventType(event.type),
            student:
              event.student?.name ??
              (event.rfidCard?.tag ? `TAG ${event.rfidCard.tag}` : 'Não identificado'),
            group: event.student?.group?.name ?? '--',
            routes:
              this.joinRouteNames(
                event.student?.routes.map((studentRoute) => studentRoute.route.name) ??
                  [],
              ) ?? '--',
            bus: event.device.bus?.plate ?? 'Sem ônibus',
            device: event.device.name ?? event.device.code ?? 'UniHub',
          },
        })),
        emptyTitle: 'Nenhum evento encontrado',
        emptyDescription:
          'Ajuste o período ou remova filtros para visualizar a movimentação.',
      },
    };
  }

  private async buildStudentsReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    const studentWhere: Prisma.StudentWhereInput = {
      companyId,
      ...this.buildStudentScope(filters),
    };

    const [students, events] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where: studentWhere,
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          registration: true,
          active: true,
          group: {
            select: {
              name: true,
            },
          },
          routes: {
            select: {
              route: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.transportEvent.findMany({
        where: {
          companyId,
          createdAt: this.buildDateRange(filters.startDate, filters.endDate),
          studentId: {
            not: null,
          },
          ...(filters.busId ? { device: { busId: filters.busId } } : {}),
          student: {
            ...this.buildStudentScope(filters),
          },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          studentId: true,
          type: true,
          createdAt: true,
          device: {
            select: {
              bus: {
                select: {
                  plate: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const chart = this.createDailyChartData(filters.startDate, filters.endDate, {
      activeStudents: 0,
      boardings: 0,
    });
    const chartStudentSets = new Map<string, Set<string>>();
    const eventsByStudent = new Map<
      string,
      {
        boardings: number;
        deboardings: number;
        denied: number;
        days: Set<string>;
        lastEventAt: Date | null;
        lastBusPlate: string | null;
      }
    >();

    for (const student of students) {
      eventsByStudent.set(student.id, {
        boardings: 0,
        deboardings: 0,
        denied: 0,
        days: new Set<string>(),
        lastEventAt: null,
        lastBusPlate: null,
      });
    }

    let totalBoardings = 0;

    for (const event of events) {
      if (!event.studentId) {
        continue;
      }

      const metrics = eventsByStudent.get(event.studentId);
      const dateKey = this.getDateKey(event.createdAt);
      const bucket = chart.index.get(dateKey);

      if (!metrics) {
        continue;
      }

      metrics.days.add(dateKey);
      metrics.lastEventAt = metrics.lastEventAt ?? event.createdAt;
      metrics.lastBusPlate =
        metrics.lastBusPlate ?? event.device.bus?.plate ?? 'Sem ônibus';

      const studentSet = chartStudentSets.get(dateKey) ?? new Set<string>();
      studentSet.add(event.studentId);
      chartStudentSets.set(dateKey, studentSet);

      if (event.type === 'BOARDING') {
        metrics.boardings += 1;
        totalBoardings += 1;
        bucket && (bucket.boardings += 1);
      } else if (event.type === 'DEBOARDING') {
        metrics.deboardings += 1;
      } else if (event.type === 'DENIED') {
        metrics.denied += 1;
      }
    }

    for (const point of chart.data) {
      point.activeStudents = chartStudentSets.get(point.date)?.size ?? 0;
    }

    const studentsWithUsage = Array.from(eventsByStudent.values()).filter(
      (metrics) => metrics.boardings > 0 || metrics.deboardings > 0 || metrics.denied > 0,
    ).length;

    return {
      type: 'students',
      title: 'Relatório de frequência',
      description:
        'Resume o comportamento dos alunos no período e ajuda a identificar uso, ausência e recorrência.',
      highlight: this.formatPeriodLabel(filters.startDate, filters.endDate),
      summaryCards: [
        {
          label: 'Alunos filtrados',
          value: this.formatCount(students.length),
          helper: 'Base considerada apos aplicar os filtros.',
        },
        {
          label: 'Com movimentação',
          value: this.formatCount(studentsWithUsage),
          helper: 'Alunos que tiveram ao menos um evento no período.',
        },
        {
          label: 'Sem movimentação',
          value: this.formatCount(Math.max(0, students.length - studentsWithUsage)),
          helper: 'Ajuda a localizar ausencias ou falta de uso.',
        },
        {
          label: 'Média de boardings/aluno',
          value: this.formatDecimal(
            students.length > 0 ? totalBoardings / students.length : 0,
          ),
          helper: 'Taxa media considerando os alunos filtrados.',
        },
      ],
      chart: {
        title: 'Frequência diária',
        description:
          'Compara alunos ativos no período com o volume de boardings registrados por dia.',
        xKey: 'date',
        series: [
          { key: 'activeStudents', label: 'Alunos com uso', color: '#ffb27a' },
          { key: 'boardings', label: 'Boardings', color: '#ff5c00' },
        ],
        data: chart.data,
      },
      table: {
        title: 'Resumo por aluno',
        description:
          'Mostra situação, recorrência e último ponto conhecido de movimentação.',
        columns: [
          { key: 'student', label: 'Aluno' },
          { key: 'status', label: 'Status' },
          { key: 'group', label: 'Grupo' },
          { key: 'routes', label: 'Rotas' },
          { key: 'days', label: 'Dias com uso' },
          { key: 'boardings', label: 'Boardings' },
          { key: 'deboardings', label: 'Desembarques' },
          { key: 'lastEvent', label: 'Último registro' },
          { key: 'lastBus', label: 'Último ônibus' },
        ],
        rows: students
          .map((student) => {
            const metrics = eventsByStudent.get(student.id);

            return {
              id: student.id,
              values: {
                student: `${student.name} (${student.registration})`,
                status: student.active ? 'Ativo' : 'Inativo',
                group: student.group?.name ?? '--',
                routes:
                  this.joinRouteNames(
                    student.routes.map((studentRoute) => studentRoute.route.name),
                  ) ?? '--',
                days: this.formatCount(metrics?.days.size ?? 0),
                boardings: this.formatCount(metrics?.boardings ?? 0),
                deboardings: this.formatCount(metrics?.deboardings ?? 0),
                lastEvent: metrics?.lastEventAt
                  ? this.formatDateTime(metrics.lastEventAt)
                  : '--',
                lastBus: metrics?.lastBusPlate ?? '--',
              },
              sortBoardings: metrics?.boardings ?? 0,
              sortDays: metrics?.days.size ?? 0,
            };
          })
          .sort((left, right) => {
            if (right.sortBoardings !== left.sortBoardings) {
              return right.sortBoardings - left.sortBoardings;
            }

            if (right.sortDays !== left.sortDays) {
              return right.sortDays - left.sortDays;
            }

            return left.values.student.localeCompare(right.values.student);
          })
          .map(({ id, values }) => ({ id, values })),
        emptyTitle: 'Nenhum aluno encontrado',
        emptyDescription:
          'Revise os filtros de grupo, rota ou status para montar a base do relatório.',
      },
    };
  }

  private async buildFleetReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    const [buses, events, trips] = await this.prisma.$transaction([
      this.prisma.bus.findMany({
        where: {
          companyId,
          ...(filters.busId ? { id: filters.busId } : {}),
          ...(filters.routeId
            ? {
                OR: [
                  {
                    schedules: {
                      some: {
                        routeId: filters.routeId,
                      },
                    },
                  },
                  {
                    devices: {
                      some: {
                        transportEvents: {
                          some: {
                            createdAt: this.buildDateRange(
                              filters.startDate,
                              filters.endDate,
                            ),
                          },
                        },
                      },
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: {
          plate: 'asc',
        },
        select: {
          id: true,
          plate: true,
          capacity: true,
          devices: {
            select: {
              id: true,
              name: true,
              code: true,
              active: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
          schedules: {
            select: {
              route: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.transportEvent.findMany({
        where: {
          companyId,
          createdAt: this.buildDateRange(filters.startDate, filters.endDate),
          device: {
            busId: {
              not: null,
              ...(filters.busId ? { equals: filters.busId } : {}),
            },
          },
          ...this.buildTransportEventStudentScope(filters),
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          createdAt: true,
          studentId: true,
          device: {
            select: {
              name: true,
              code: true,
              bus: {
                select: {
                  id: true,
                  plate: true,
                  capacity: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          companyId,
          startedAt: this.buildDateRange(filters.startDate, filters.endDate),
          busId: {
            not: null,
            ...(filters.busId ? { equals: filters.busId } : {}),
          },
          ...(filters.routeId
            ? {
                bus: {
                  schedules: {
                    some: {
                      routeId: filters.routeId,
                    },
                  },
                },
              }
            : {}),
        },
        orderBy: { startedAt: 'desc' },
        select: {
          id: true,
          startedAt: true,
          busId: true,
        },
      }),
    ]);

    const busMap = new Map<
      string,
      {
        id: string;
        plate: string;
        capacity: number;
        deviceNames: string[];
        routeNames: string[];
        trips: number;
        boardings: number;
        deboardings: number;
        denied: number;
        uniqueStudents: Set<string>;
        lastEventAt: Date | null;
      }
    >();

    for (const bus of buses) {
      busMap.set(bus.id, {
        id: bus.id,
        plate: bus.plate,
        capacity: bus.capacity,
        deviceNames: bus.devices.map(
          (device) => device.name ?? device.code ?? 'UniHub',
        ),
        routeNames: Array.from(
          new Set(bus.schedules.map((schedule) => schedule.route.name)),
        ),
        trips: 0,
        boardings: 0,
        deboardings: 0,
        denied: 0,
        uniqueStudents: new Set<string>(),
        lastEventAt: null,
      });
    }

    const chart = this.createDailyChartData(filters.startDate, filters.endDate, {
      trips: 0,
      boardings: 0,
      activeBuses: 0,
    });
    const chartBusSets = new Map<string, Set<string>>();

    for (const event of events) {
      const bus = event.device.bus;

      if (!bus) {
        continue;
      }

      const record =
        busMap.get(bus.id) ??
        {
          id: bus.id,
          plate: bus.plate,
          capacity: bus.capacity,
          deviceNames: [event.device.name ?? event.device.code ?? 'UniHub'],
          routeNames: [],
          trips: 0,
          boardings: 0,
          deboardings: 0,
          denied: 0,
          uniqueStudents: new Set<string>(),
          lastEventAt: null,
        };

      record.lastEventAt = record.lastEventAt ?? event.createdAt;

      if (event.studentId) {
        record.uniqueStudents.add(event.studentId);
      }

      if (event.type === 'BOARDING') {
        record.boardings += 1;
      } else if (event.type === 'DEBOARDING') {
        record.deboardings += 1;
      } else if (event.type === 'DENIED') {
        record.denied += 1;
      }

      busMap.set(bus.id, record);

      const dateKey = this.getDateKey(event.createdAt);
      const bucket = chart.index.get(dateKey);

      if (event.type === 'BOARDING' && bucket) {
        bucket.boardings += 1;
      }

      const busSet = chartBusSets.get(dateKey) ?? new Set<string>();
      busSet.add(bus.id);
      chartBusSets.set(dateKey, busSet);
    }

    for (const trip of trips) {
      if (!trip.busId) {
        continue;
      }

      const record = busMap.get(trip.busId);

      if (record) {
        record.trips += 1;
      }

      const dateKey = this.getDateKey(trip.startedAt);
      const bucket = chart.index.get(dateKey);

      if (bucket) {
        bucket.trips += 1;
      }

      const busSet = chartBusSets.get(dateKey) ?? new Set<string>();
      busSet.add(trip.busId);
      chartBusSets.set(dateKey, busSet);
    }

    for (const point of chart.data) {
      point.activeBuses = chartBusSets.get(point.date)?.size ?? 0;
    }

    const rows = Array.from(busMap.values()).sort((left, right) => {
      if (right.boardings !== left.boardings) {
        return right.boardings - left.boardings;
      }

      if (right.trips !== left.trips) {
        return right.trips - left.trips;
      }

      return left.plate.localeCompare(right.plate);
    });

    const busesWithActivity = rows.filter(
      (row) => row.trips > 0 || row.boardings > 0 || row.deboardings > 0 || row.denied > 0,
    ).length;
    const totalBoardings = rows.reduce((sum, row) => sum + row.boardings, 0);

    return {
      type: 'fleet',
      title: 'Relatório de frota',
      description:
        'Consolida o uso de ônibus e dispositivos no período, ajudando a enxergar a carga operacional.',
      highlight: this.formatPeriodLabel(filters.startDate, filters.endDate),
      summaryCards: [
        {
          label: 'Ônibus analisados',
          value: this.formatCount(rows.length),
          helper: 'Quantidade de veiculos considerados no recorte.',
        },
        {
          label: 'Com atividade',
          value: this.formatCount(busesWithActivity),
          helper: 'Ônibus com viagem ou evento registrado.',
        },
        {
          label: 'Viagens registradas',
          value: this.formatCount(trips.length),
          helper: 'Saídas registradas no período.',
        },
        {
          label: 'Média de boardings/ônibus',
          value: this.formatDecimal(rows.length > 0 ? totalBoardings / rows.length : 0),
          helper: 'Volume medio de entradas por veiculo filtrado.',
        },
      ],
      chart: {
        title: 'Carga operacional por dia',
        description:
          'Cruza boardings, viagens registradas e a quantidade de ônibus ativos por dia.',
        xKey: 'date',
        series: [
          { key: 'trips', label: 'Viagens', color: '#ffd0b2' },
          { key: 'boardings', label: 'Boardings', color: '#ff7a2f' },
          { key: 'activeBuses', label: 'Ônibus ativos', color: '#c2410c' },
        ],
        data: chart.data,
      },
      table: {
        title: 'Resumo por ônibus',
        description:
          'Ajuda a comparar uso, lotacao potencial, dispositivos e rotas vinculadas.',
        columns: [
          { key: 'bus', label: 'Ônibus' },
          { key: 'capacity', label: 'Capacidade' },
          { key: 'devices', label: 'UniHubs' },
          { key: 'routes', label: 'Rotas vinculadas' },
          { key: 'trips', label: 'Viagens' },
          { key: 'boardings', label: 'Boardings' },
          { key: 'deboardings', label: 'Desembarques' },
          { key: 'students', label: 'Alunos unicos' },
          { key: 'lastEvent', label: 'Último evento' },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          values: {
            bus: row.plate,
            capacity: this.formatCount(row.capacity),
            devices: row.deviceNames.join(', ') || '--',
            routes: this.joinRouteNames(row.routeNames) ?? '--',
            trips: this.formatCount(row.trips),
            boardings: this.formatCount(row.boardings),
            deboardings: this.formatCount(row.deboardings),
            students: this.formatCount(row.uniqueStudents.size),
            lastEvent: row.lastEventAt ? this.formatDateTime(row.lastEventAt) : '--',
          },
        })),
        emptyTitle: 'Nenhum ônibus encontrado',
        emptyDescription:
          'Use outro período ou revise os filtros de rota e ônibus para montar o relatório.',
      },
    };
  }

  private async buildRoutesReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    const studentScope = this.buildStudentScope(filters);
    const [routes, events] = await this.prisma.$transaction([
      this.prisma.route.findMany({
        where: {
          companyId,
          ...(filters.routeId ? { id: filters.routeId } : {}),
        },
        orderBy: {
          name: 'asc',
        },
        select: {
          id: true,
          name: true,
          active: true,
          schedules: {
            select: {
              id: true,
            },
          },
          students: {
            where: {
              ...(Object.keys(studentScope).length > 0
                ? {
                    student: studentScope,
                  }
                : {}),
            },
            select: {
              student: {
                select: {
                  id: true,
                  active: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.transportEvent.findMany({
        where: {
          companyId,
          createdAt: this.buildDateRange(filters.startDate, filters.endDate),
          studentId: {
            not: null,
          },
          ...(filters.busId ? { device: { busId: filters.busId } } : {}),
          student: {
            ...studentScope,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          studentId: true,
          student: {
            select: {
              routes: {
                select: {
                  route: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const routeMap = new Map<
      string,
      {
        id: string;
        name: string;
        active: boolean;
        schedules: number;
        assignedStudents: number;
        activeStudents: number;
        boardings: number;
        deboardings: number;
        denied: number;
        uniqueStudents: Set<string>;
        lastEventAt: Date | null;
      }
    >();

    for (const route of routes) {
      const assignedStudentIds = new Set(
        route.students.map((item) => item.student.id),
      );
      const activeStudents = route.students.filter(
        (item) => item.student.active,
      ).length;

      routeMap.set(route.id, {
        id: route.id,
        name: route.name,
        active: route.active,
        schedules: route.schedules.length,
        assignedStudents: assignedStudentIds.size,
        activeStudents,
        boardings: 0,
        deboardings: 0,
        denied: 0,
        uniqueStudents: new Set<string>(),
        lastEventAt: null,
      });
    }

    const chart = this.createDailyChartData(filters.startDate, filters.endDate, {
      routesWithMovement: 0,
      boardings: 0,
    });
    const chartRouteSets = new Map<string, Set<string>>();

    for (const event of events) {
      if (!event.studentId) {
        continue;
      }

      const relatedRouteIds = event.student?.routes
        .map((item) => item.route.id)
        .filter((routeId) => routeMap.has(routeId));

      if (!relatedRouteIds || relatedRouteIds.length === 0) {
        continue;
      }

      const dateKey = this.getDateKey(event.createdAt);
      const routeSet = chartRouteSets.get(dateKey) ?? new Set<string>();

      for (const routeId of relatedRouteIds) {
        const record = routeMap.get(routeId);

        if (!record) {
          continue;
        }

        record.lastEventAt = record.lastEventAt ?? event.createdAt;
        record.uniqueStudents.add(event.studentId);
        routeSet.add(routeId);

        if (event.type === 'BOARDING') {
          record.boardings += 1;
        } else if (event.type === 'DEBOARDING') {
          record.deboardings += 1;
        } else if (event.type === 'DENIED') {
          record.denied += 1;
        }
      }

      chartRouteSets.set(dateKey, routeSet);

      if (event.type === 'BOARDING') {
        const bucket = chart.index.get(dateKey);
        if (bucket) {
          bucket.boardings += 1;
        }
      }
    }

    for (const point of chart.data) {
      point.routesWithMovement = chartRouteSets.get(point.date)?.size ?? 0;
    }

    const rows = Array.from(routeMap.values()).sort((left, right) => {
      if (right.boardings !== left.boardings) {
        return right.boardings - left.boardings;
      }

      return left.name.localeCompare(right.name);
    });

    const routesWithMovement = rows.filter(
      (row) => row.boardings > 0 || row.deboardings > 0 || row.denied > 0,
    ).length;
    const assignedStudents = new Set(
      routes.flatMap((route) => route.students.map((item) => item.student.id)),
    ).size;

    return {
      type: 'routes',
      title: 'Relatório de rotas',
      description:
        'Resume rotas cadastradas, alunos vinculados e o uso operacional no período filtrado.',
      highlight: this.formatPeriodLabel(filters.startDate, filters.endDate),
      summaryCards: [
        {
          label: 'Rotas analisadas',
          value: this.formatCount(rows.length),
          helper: 'Quantidade de rotas consideradas no relatório.',
        },
        {
          label: 'Rotas com uso',
          value: this.formatCount(routesWithMovement),
          helper: 'Rotas com pelo menos um evento de transporte.',
        },
        {
          label: 'Alunos vinculados',
          value: this.formatCount(assignedStudents),
          helper: 'Total único de alunos vinculados nas rotas filtradas.',
        },
        {
          label: 'Boardings nas rotas',
          value: this.formatCount(
            rows.reduce((sum, row) => sum + row.boardings, 0),
          ),
          helper: 'Entradas associadas aos alunos vinculados nas rotas.',
        },
      ],
      chart: {
        title: 'Uso por dia nas rotas',
        description:
          'Compara o volume de boardings com a quantidade de rotas que tiveram movimentação.',
        xKey: 'date',
        series: [
          { key: 'boardings', label: 'Boardings', color: '#ff8b4c' },
          {
            key: 'routesWithMovement',
            label: 'Rotas com uso',
            color: '#c2410c',
          },
        ],
        data: chart.data,
      },
      table: {
        title: 'Resumo por rota',
        description:
          'Mostra a capacidade operacional de cada rota com alunos vinculados, horários e movimentação.',
        columns: [
          { key: 'route', label: 'Rota' },
          { key: 'status', label: 'Status' },
          { key: 'students', label: 'Alunos vinculados' },
          { key: 'activeStudents', label: 'Ativos' },
          { key: 'schedules', label: 'Horarios' },
          { key: 'boardings', label: 'Boardings' },
          { key: 'deboardings', label: 'Desembarques' },
          { key: 'studentsWithUsage', label: 'Alunos com uso' },
          { key: 'lastEvent', label: 'Último evento' },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          values: {
            route: row.name,
            status: row.active ? 'Ativa' : 'Inativa',
            students: this.formatCount(row.assignedStudents),
            activeStudents: this.formatCount(row.activeStudents),
            schedules: this.formatCount(row.schedules),
            boardings: this.formatCount(row.boardings),
            deboardings: this.formatCount(row.deboardings),
            studentsWithUsage: this.formatCount(row.uniqueStudents.size),
            lastEvent: row.lastEventAt ? this.formatDateTime(row.lastEventAt) : '--',
          },
        })),
        emptyTitle: 'Nenhuma rota encontrada',
        emptyDescription:
          'Ajuste os filtros para localizar rotas com alunos vinculados ou movimentação.',
      },
    };
  }

  private async buildGroupsReport(
    companyId: string,
    filters: DashboardReportFilters,
  ): Promise<DashboardReportPayload> {
    const studentScope = this.buildStudentScope(filters);
    const [groups, events] = await this.prisma.$transaction([
      this.prisma.group.findMany({
        where: {
          companyId,
          ...(filters.groupId ? { id: filters.groupId } : {}),
        },
        orderBy: {
          name: 'asc',
        },
        select: {
          id: true,
          name: true,
          active: true,
          students: {
            where: Object.keys(studentScope).length > 0 ? studentScope : {},
            select: {
              id: true,
              active: true,
            },
          },
        },
      }),
      this.prisma.transportEvent.findMany({
        where: {
          companyId,
          createdAt: this.buildDateRange(filters.startDate, filters.endDate),
          studentId: {
            not: null,
          },
          ...(filters.busId ? { device: { busId: filters.busId } } : {}),
          student: {
            ...studentScope,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          type: true,
          createdAt: true,
          studentId: true,
          student: {
            select: {
              groupId: true,
            },
          },
        },
      }),
    ]);

    const groupMap = new Map<
      string,
      {
        id: string;
        name: string;
        active: boolean;
        students: number;
        activeStudents: number;
        boardings: number;
        deboardings: number;
        denied: number;
        uniqueStudents: Set<string>;
        lastEventAt: Date | null;
      }
    >();

    for (const group of groups) {
      groupMap.set(group.id, {
        id: group.id,
        name: group.name,
        active: group.active,
        students: group.students.length,
        activeStudents: group.students.filter((student) => student.active).length,
        boardings: 0,
        deboardings: 0,
        denied: 0,
        uniqueStudents: new Set<string>(),
        lastEventAt: null,
      });
    }

    const chart = this.createDailyChartData(filters.startDate, filters.endDate, {
      groupsWithMovement: 0,
      boardings: 0,
    });
    const chartGroupSets = new Map<string, Set<string>>();

    for (const event of events) {
      const groupId = event.student?.groupId;

      if (!event.studentId || !groupId || !groupMap.has(groupId)) {
        continue;
      }

      const record = groupMap.get(groupId);

      if (!record) {
        continue;
      }

      record.lastEventAt = record.lastEventAt ?? event.createdAt;
      record.uniqueStudents.add(event.studentId);

      if (event.type === 'BOARDING') {
        record.boardings += 1;
      } else if (event.type === 'DEBOARDING') {
        record.deboardings += 1;
      } else if (event.type === 'DENIED') {
        record.denied += 1;
      }

      const dateKey = this.getDateKey(event.createdAt);
      const groupSet = chartGroupSets.get(dateKey) ?? new Set<string>();
      groupSet.add(groupId);
      chartGroupSets.set(dateKey, groupSet);

      if (event.type === 'BOARDING') {
        const bucket = chart.index.get(dateKey);
        if (bucket) {
          bucket.boardings += 1;
        }
      }
    }

    for (const point of chart.data) {
      point.groupsWithMovement = chartGroupSets.get(point.date)?.size ?? 0;
    }

    const rows = Array.from(groupMap.values()).sort((left, right) => {
      if (right.boardings !== left.boardings) {
        return right.boardings - left.boardings;
      }

      return left.name.localeCompare(right.name);
    });

    const groupsWithMovement = rows.filter(
      (row) => row.boardings > 0 || row.deboardings > 0 || row.denied > 0,
    ).length;

    return {
      type: 'groups',
      title: 'Relatório de grupos',
      description:
          'Compara os grupos da empresa e destaca quais concentraram mais alunos e uso no transporte.',
      highlight: this.formatPeriodLabel(filters.startDate, filters.endDate),
      summaryCards: [
        {
          label: 'Grupos analisados',
          value: this.formatCount(rows.length),
          helper: 'Total de grupos considerados nos filtros.',
        },
        {
          label: 'Com movimentação',
          value: this.formatCount(groupsWithMovement),
          helper: 'Grupos com pelo menos um evento de transporte no período.',
        },
        {
          label: 'Alunos nos grupos',
          value: this.formatCount(
            rows.reduce((sum, row) => sum + row.students, 0),
          ),
          helper: 'Soma dos alunos distribuídos nos grupos filtrados.',
        },
        {
          label: 'Média de boardings/grupo',
          value: this.formatDecimal(
            rows.length > 0
              ? rows.reduce((sum, row) => sum + row.boardings, 0) / rows.length
              : 0,
          ),
          helper: 'Ajuda a comparar intensidade de uso entre grupos.',
        },
      ],
      chart: {
        title: 'Uso dos grupos por dia',
        description:
          'Mostra os boardings do período e quantos grupos tiveram movimentação diária.',
        xKey: 'date',
        series: [
          { key: 'boardings', label: 'Boardings', color: '#ff8d54' },
          {
            key: 'groupsWithMovement',
            label: 'Grupos com uso',
            color: '#ea580c',
          },
        ],
        data: chart.data,
      },
      table: {
        title: 'Resumo por grupo',
        description:
          'Leitura rapida para comparar base de alunos, uso do transporte e ultimo movimento por grupo.',
        columns: [
          { key: 'group', label: 'Grupo' },
          { key: 'status', label: 'Status' },
          { key: 'students', label: 'Alunos' },
          { key: 'activeStudents', label: 'Ativos' },
          { key: 'boardings', label: 'Boardings' },
          { key: 'deboardings', label: 'Desembarques' },
          { key: 'denied', label: 'Negados' },
          { key: 'studentsWithUsage', label: 'Alunos com uso' },
          { key: 'lastEvent', label: 'Último evento' },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          values: {
            group: row.name,
            status: row.active ? 'Ativo' : 'Inativo',
            students: this.formatCount(row.students),
            activeStudents: this.formatCount(row.activeStudents),
            boardings: this.formatCount(row.boardings),
            deboardings: this.formatCount(row.deboardings),
            denied: this.formatCount(row.denied),
            studentsWithUsage: this.formatCount(row.uniqueStudents.size),
            lastEvent: row.lastEventAt ? this.formatDateTime(row.lastEventAt) : '--',
          },
        })),
        emptyTitle: 'Nenhum grupo encontrado',
        emptyDescription:
          'Revise os filtros para encontrar grupos com alunos vinculados ou uso no período.',
      },
    };
  }

  private normalizeReportFilters(
    query: GetDashboardReportDto,
  ): DashboardReportFilters {
    const todayDateKey = this.getDateKey(new Date());
    const endDate = query.endDate || todayDateKey;
    const startDate = query.startDate || addDaysToDateKey(endDate, -6);

    if (startDate > endDate) {
      throw new BadRequestException(
        'A data inicial não pode ser maior que a data final.',
      );
    }

    return {
      reportType: query.reportType ?? 'boarding',
      startDate,
      endDate,
      busId: this.normalizeFilterValue(query.busId),
      routeId: this.normalizeFilterValue(query.routeId),
      groupId: this.normalizeFilterValue(query.groupId),
      eventType: query.eventType ?? 'ALL',
      studentStatus: query.studentStatus ?? 'all',
    };
  }

  private normalizeFilterValue(value?: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.trim();

    return normalized && normalized !== 'all' ? normalized : null;
  }

  private async getReportOptions(companyId: string) {
    const [buses, routes, groups] = await this.prisma.$transaction([
      this.prisma.bus.findMany({
        where: { companyId },
        orderBy: { plate: 'asc' },
        select: {
          id: true,
          plate: true,
          capacity: true,
        },
      }),
      this.prisma.route.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          active: true,
        },
      }),
      this.prisma.group.findMany({
        where: { companyId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          active: true,
        },
      }),
    ]);

    return {
      buses: buses.map((bus) => ({
        value: bus.id,
        label: `${bus.plate} - ${bus.capacity} lugares`,
      })),
      routes: routes.map((route) => ({
        value: route.id,
        label: route.active ? route.name : `${route.name} (inativa)`,
      })),
      groups: groups.map((group) => ({
        value: group.id,
        label: group.active ? group.name : `${group.name} (inativo)`,
      })),
    };
  }

  private buildStudentScope(filters: DashboardReportFilters) {
    return {
      ...(filters.groupId ? { groupId: filters.groupId } : {}),
      ...(filters.routeId
        ? {
            routes: {
              some: {
                routeId: filters.routeId,
              },
            },
          }
        : {}),
      ...(filters.studentStatus === 'active'
        ? { active: true }
        : filters.studentStatus === 'inactive'
          ? { active: false }
          : {}),
    } satisfies Prisma.StudentWhereInput;
  }

  private buildTransportEventStudentScope(filters: DashboardReportFilters) {
    const studentScope = this.buildStudentScope(filters);

    return Object.keys(studentScope).length > 0
      ? {
          student: studentScope,
        }
      : {};
  }

  private buildDateRange(startDate: string, endDate: string) {
    return {
      gte: this.parseDateKey(startDate, false),
      lte: this.parseDateKey(endDate, true),
    } satisfies Prisma.DateTimeFilter;
  }

  private parseDateKey(dateKey: string, endOfDay: boolean) {
    const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${dateKey}T${time}-03:00`);
  }

  private createDailyChartData<T extends Record<string, number>>(
    startDate: string,
    endDate: string,
    baseValues: T,
  ) {
    const data: Array<{ date: string } & T> = [];
    const index = new Map<string, { date: string } & T>();

    let currentDate = startDate;

    while (currentDate <= endDate) {
      const entry = {
        date: currentDate,
        ...Object.fromEntries(
          Object.keys(baseValues).map((key) => [key, baseValues[key]]),
        ),
      } as { date: string } & T;

      data.push(entry);
      index.set(currentDate, entry);
      currentDate = addDaysToDateKey(currentDate, 1);
    }

    return { data, index };
  }

  private joinRouteNames(routeNames: string[]) {
    const uniqueNames = Array.from(
      new Set(routeNames.map((routeName) => routeName.trim()).filter(Boolean)),
    );

    return uniqueNames.length > 0 ? uniqueNames.join(', ') : null;
  }

  private formatCount(value: number) {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: 0,
    }).format(value);
  }

  private formatDecimal(value: number) {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value);
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: this.getTimeZone(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private formatDateTime(date: Date) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: this.getTimeZone(),
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private formatPeriodLabel(startDate: string, endDate: string) {
    return `Periodo ${this.formatDate(this.parseDateKey(startDate, false))} ate ${this.formatDate(this.parseDateKey(endDate, true))}`;
  }

  private getDateKey(date: Date) {
    return getZonedDateParts(date, this.getTimeZone()).dateKey;
  }

  private getTimeZone() {
    return getAppTimeZone(this.configService.get<string>('APP_TIMEZONE'));
  }

  private formatEventType(type: EventType) {
    const labels: Record<EventType, string> = {
      BOARDING: 'Boarding',
      DEBOARDING: 'Desembarque',
      LEAVING: 'Saida',
      DENIED: 'Negado',
    };

    return labels[type];
  }
}
