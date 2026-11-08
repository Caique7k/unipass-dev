import {
  addDaysToDateKey,
  getZonedDateParts,
  getZonedDayEnd,
  getZonedDayStart,
} from './notification-time.util';

type DayCase = {
  label: string;
  timeZone: string;
  dateKey: string;
  start: string;
  end: string;
};

/**
 * Começo do dia = primeiro instante cujo dia, no fuso, é dateKey.
 * Fim do dia = começo do dia seguinte menos 1 ms.
 */
const CASES: DayCase[] = [
  {
    label: 'UTC (controle)',
    timeZone: 'UTC',
    dateKey: '2026-11-01',
    start: '2026-11-01T00:00:00.000Z',
    end: '2026-11-01T23:59:59.999Z',
  },
  {
    label: 'America/Sao_Paulo',
    timeZone: 'America/Sao_Paulo',
    dateKey: '2026-11-01',
    start: '2026-11-01T03:00:00.000Z',
    end: '2026-11-02T02:59:59.999Z',
  },
  {
    label: 'America/Manaus',
    timeZone: 'America/Manaus',
    dateKey: '2026-11-01',
    start: '2026-11-01T04:00:00.000Z',
    end: '2026-11-02T03:59:59.999Z',
  },
  {
    label: 'America/New_York, dia de 25 h (fim do horário de verão)',
    timeZone: 'America/New_York',
    dateKey: '2026-11-01',
    start: '2026-11-01T04:00:00.000Z',
    end: '2026-11-02T04:59:59.999Z',
  },
  {
    label: 'America/New_York, dia de 23 h (começo do horário de verão)',
    timeZone: 'America/New_York',
    dateKey: '2026-03-08',
    start: '2026-03-08T05:00:00.000Z',
    end: '2026-03-09T03:59:59.999Z',
  },
  {
    label: 'America/Sao_Paulo, véspera do horário de verão de 2018',
    timeZone: 'America/Sao_Paulo',
    dateKey: '2018-11-03',
    start: '2018-11-03T03:00:00.000Z',
    end: '2018-11-04T02:59:59.999Z',
  },
  {
    label:
      'America/Sao_Paulo, 2018-11-04: a meia-noite não existiu (00:00 → 01:00)',
    timeZone: 'America/Sao_Paulo',
    dateKey: '2018-11-04',
    start: '2018-11-04T03:00:00.000Z',
    end: '2018-11-05T01:59:59.999Z',
  },
  {
    label:
      'America/Santiago, horário de verão termina às 24:00: a hora repetida é do próprio dia',
    timeZone: 'America/Santiago',
    dateKey: '2026-04-04',
    start: '2026-04-04T03:00:00.000Z',
    end: '2026-04-05T03:59:59.999Z',
  },
  {
    label: 'Pacific/Kiritimati (UTC+14, uma ponta da janela da busca)',
    timeZone: 'Pacific/Kiritimati',
    dateKey: '2026-11-01',
    start: '2026-10-31T10:00:00.000Z',
    end: '2026-11-01T09:59:59.999Z',
  },
  {
    label: 'Etc/GMT+12 (UTC−12, a outra ponta)',
    timeZone: 'Etc/GMT+12',
    dateKey: '2026-11-01',
    start: '2026-11-01T12:00:00.000Z',
    end: '2026-11-02T11:59:59.999Z',
  },
];

describe('getZonedDayStart / getZonedDayEnd', () => {
  it.each(CASES)('$label', ({ timeZone, dateKey, start, end }) => {
    const dayStart = getZonedDayStart(dateKey, timeZone);
    const dayEnd = getZonedDayEnd(dateKey, timeZone);

    expect(dayStart.toISOString()).toBe(start);
    expect(dayEnd.toISOString()).toBe(end);

    // A própria definição: no começo já é o dia e 1 ms antes ainda é o
    // anterior; no fim ainda é o dia e 1 ms depois já é o seguinte.
    const dayAt = (time: number) =>
      getZonedDateParts(new Date(time), timeZone).dateKey;

    expect(dayAt(dayStart.getTime())).toBe(dateKey);
    expect(dayAt(dayStart.getTime() - 1)).toBe(addDaysToDateKey(dateKey, -1));
    expect(dayAt(dayEnd.getTime())).toBe(dateKey);
    expect(dayAt(dayEnd.getTime() + 1)).toBe(addDaysToDateKey(dateKey, 1));
  });
});
