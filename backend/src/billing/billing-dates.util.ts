import { BadRequestException } from '@nestjs/common';

/**
 * Datas das cobranças. Datas de calendário (vencimento, emissão) são
 * gravadas ao meio-dia UTC para o dia não "escorregar" em nenhum fuso.
 */

export function buildChargeDescription(
  templateName: string,
  referenceMonth: string,
) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})$/.exec(referenceMonth);

  if (!match?.groups) {
    return templateName;
  }

  return `${templateName} - ${match.groups.month}/${match.groups.year}`;
}

export function buildDueDate(referenceMonth: string, dueDay: number) {
  const monthRange = getMonthRange(referenceMonth);
  const maxDay = new Date(
    Date.UTC(
      monthRange.start.getUTCFullYear(),
      monthRange.start.getUTCMonth() + 1,
      0,
      12,
      0,
      0,
    ),
  ).getUTCDate();
  const normalizedDueDay = Math.min(Math.max(dueDay, 1), maxDay);

  return new Date(
    Date.UTC(
      monthRange.start.getUTCFullYear(),
      monthRange.start.getUTCMonth(),
      normalizedDueDay,
      12,
      0,
      0,
    ),
  );
}

export function parseDateKey(value: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/.exec(value);

  if (!match?.groups) {
    return null;
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function getMonthRange(value: string) {
  const match = /^(?<year>\d{4})-(?<month>\d{2})$/.exec(value);

  if (!match?.groups) {
    throw new BadRequestException('Informe um mes de referencia valido.');
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new BadRequestException('Informe um mes de referencia valido.');
  }

  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    endExclusive: new Date(Date.UTC(year, month, 1, 0, 0, 0)),
  };
}

/** Date gravada ao meio-dia UTC -> "YYYY-MM-DD". */
export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
