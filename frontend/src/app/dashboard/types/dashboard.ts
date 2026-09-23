/**
 * Espelha o payload de `GET /dashboard` (DashboardService.getMetrics).
 * Se o backend mudar, este arquivo muda junto.
 */

export type EventType = "BOARDING" | "DEBOARDING" | "LEAVING" | "DENIED";
export type ScheduleType = "GO" | "BACK" | "SHIFT";
export type Trend = "up" | "down" | "flat";

export type MetricDelta = {
  value: number;
  previous: number;
  delta: number;
  trend: Trend;
};

export type DashboardAlert = {
  key: string;
  level: "info" | "warning" | "danger";
  title: string;
  description: string;
  href: string;
};

export type BillingSnapshot = {
  openCount: number;
  openAmountCents: number;
  overdueCount: number;
  overdueAmountCents: number;
  paidThisMonthCount: number;
  paidThisMonthAmountCents: number;
};

export type LiveDevice = {
  deviceId: string;
  name: string | null;
  code: string | null;
  busPlate: string | null;
  lastUpdate: string | null;
  online: boolean;
};

export type UpcomingSchedule = {
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

export type RecentEvent = {
  eventId: string;
  type: EventType;
  at: string;
  studentName: string | null;
  rfidTag: string | null;
  busPlate: string | null;
  deviceLabel: string | null;
};

export type SeriesPoint = {
  date: string;
  boardings: number;
  deboardings: number;
  denied: number;
  students: number;
};

export type DashboardMetrics = {
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
    boardings: MetricDelta;
    deboardings: MetricDelta;
    denied: MetricDelta;
    transported: MetricDelta;
    onBoardNow: number;
  };
  fleet: {
    buses: number;
    busesWithoutDevice: number;
    capacityTotal: number;
    occupancyRate: number | null;
    devices: number;
    devicesOnline: number;
    liveDevices: LiveDevice[];
  };
  schedules: {
    totalToday: number;
    completed: number;
    upcoming: UpcomingSchedule[];
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
  billing: BillingSnapshot | null;
  series: SeriesPoint[];
  recentEvents: RecentEvent[];
  alerts: DashboardAlert[];
};
