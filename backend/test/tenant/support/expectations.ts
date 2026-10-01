import { HttpException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { snapshotCompany } from './company-snapshot';

type Tenant = { label: string; fingerprints: string[] };

function serialize(value: unknown) {
  if (value instanceof HttpException) {
    return JSON.stringify({
      message: value.message,
      response: value.getResponse(),
    });
  }

  if (value instanceof Error) {
    return JSON.stringify({ message: value.message });
  }

  return JSON.stringify(value) ?? '';
}

function excerpt(text: string, at: number) {
  return text.slice(Math.max(0, at - 80), at + 80);
}

/**
 * Canário: falha se qualquer impressão digital da empresa (id de qualquer
 * linha dela, nome, documento, TAG...) aparecer em qualquer ponto do valor,
 * inclusive em campos aninhados e em mensagens de erro.
 */
export function expectNoDataFrom(value: unknown, tenant: Tenant) {
  const text = serialize(value);
  const lower = text.toLowerCase();
  const leaks = tenant.fingerprints.filter((fingerprint) =>
    lower.includes(fingerprint.toLowerCase()),
  );

  if (leaks.length > 0) {
    const at = lower.indexOf(leaks[0].toLowerCase());

    throw new Error(
      `Vazamento: dados da empresa ${tenant.label} apareceram na resposta ` +
        `(${leaks.join(', ')}).\nTrecho: ...${excerpt(text, at)}...`,
    );
  }
}

/**
 * A chamada precisa falhar com erro de cliente (4xx). Sucesso ou erro
 * inesperado (500, erro do Prisma) fazem o teste falhar.
 */
export async function expectClientError(action: Promise<unknown>) {
  let result: unknown;

  try {
    result = await action;
  } catch (error) {
    if (
      error instanceof HttpException &&
      error.getStatus() >= 400 &&
      error.getStatus() < 500
    ) {
      return error;
    }

    throw error;
  }

  throw new Error(
    `Esperava um erro 4xx, mas a chamada funcionou: ${serialize(result)}`,
  );
}

/**
 * Tira a foto das empresas antes e depois da ação: nenhuma linha delas pode
 * ter sido criada, alterada ou apagada.
 */
export async function expectCompaniesUnchanged<T>(
  prisma: PrismaService,
  companyIds: string[],
  action: () => Promise<T>,
) {
  const before = await Promise.all(
    companyIds.map((companyId) => snapshotCompany(prisma, companyId)),
  );
  const result = await action();
  const after = await Promise.all(
    companyIds.map((companyId) => snapshotCompany(prisma, companyId)),
  );

  expect(after).toEqual(before);

  return result;
}
