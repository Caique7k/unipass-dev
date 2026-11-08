const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const DEFAULT_APP_TIMEZONE = 'America/Sao_Paulo';

export type ZonedDateParts = {
  dateKey: string;
  dayOfWeek: number;
  hours: number;
  minutes: number;
  minutesOfDay: number;
};

export function getAppTimeZone(value?: string | null) {
  return value?.trim() || DEFAULT_APP_TIMEZONE;
}

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hours = Number(parts.hour);
  const minutes = Number(parts.minute);
  const dayOfWeek = WEEKDAY_MAP[parts.weekday] ?? 0;
  const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    dateKey,
    dayOfWeek,
    hours,
    minutes,
    minutesOfDay: hours * 60 + minutes,
  };
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));

  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const HOUR_MS = 60 * 60 * 1000;

// Um formatter por fuso: criar um Intl.DateTimeFormat é caro, e a busca de
// getZonedDayStart formata o mesmo fuso 27 vezes.
const dateKeyFormatters = new Map<string, Intl.DateTimeFormat>();

function getZonedDateKey(date: Date, timeZone: string) {
  let formatter = dateKeyFormatters.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dateKeyFormatters.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Primeiro instante em que `dateKey` (AAAA-MM-DD) já é o dia corrente no fuso.
 * Quase sempre é a meia-noite local; num dia em que a meia-noite não existiu
 * (horário de verão começando às 00:00, como em America/Sao_Paulo até 2018),
 * é o instante em que o relógio pulou para 01:00.
 *
 * Busca binária ao milissegundo entre 15 h antes e 13 h depois da meia-noite
 * UTC do dia, porque todo fuso começa o dia entre 14 h antes (UTC+14) e 12 h
 * depois (UTC−12) dela. Supõe que o dia no fuso nunca anda para trás; vale
 * também onde o horário de verão termina às 24:00 (Chile, Egito), porque a
 * hora repetida é a última do próprio dia.
 */
export function getZonedDayStart(dateKey: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  // Em `before` ainda é um dia anterior; em `atOrAfter` já é `dateKey` ou
  // depois.
  let before = midnightUtc - 15 * HOUR_MS;
  let atOrAfter = midnightUtc + 13 * HOUR_MS;

  while (atOrAfter - before > 1) {
    const middle = Math.floor((before + atOrAfter) / 2);

    if (getZonedDateKey(new Date(middle), timeZone) >= dateKey) {
      atOrAfter = middle;
    } else {
      before = middle;
    }
  }

  return new Date(atOrAfter);
}

/**
 * Último milissegundo de `dateKey` no fuso: o começo do dia seguinte menos
 * 1 ms (o dia pode ter 23 ou 25 h).
 */
export function getZonedDayEnd(dateKey: string, timeZone: string): Date {
  const nextDayStart = getZonedDayStart(addDaysToDateKey(dateKey, 1), timeZone);

  return new Date(nextDayStart.getTime() - 1);
}

export function isPromptExpired(params: {
  occurrenceKey: string;
  departureMinutes: number;
  now: Date;
  timeZone: string;
}) {
  const current = getZonedDateParts(params.now, params.timeZone);

  if (current.dateKey > params.occurrenceKey) {
    return true;
  }

  if (current.dateKey < params.occurrenceKey) {
    return false;
  }

  return current.minutesOfDay > params.departureMinutes;
}
