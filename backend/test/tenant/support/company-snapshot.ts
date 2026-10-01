import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export type CompanySnapshot = Record<string, unknown[]>;

type Delegate = {
  findMany(args: { where: object; orderBy: object }): Promise<unknown[]>;
};

// Tabelas sem coluna companyId: o caminho até a empresa passa por uma relação.
const LINKED_TABLES: Record<string, (companyId: string) => object> = {
  routeSchedule: (companyId) => ({ route: { companyId } }),
  studentRoute: (companyId) => ({ student: { companyId } }),
  scheduleConfirmation: (companyId) => ({ user: { companyId } }),
  notificationPrompt: (companyId) => ({ user: { companyId } }),
  pushSubscription: (companyId) => ({ user: { companyId } }),
};

function delegateName(modelName: string) {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function whereForCompany(model: Prisma.DMMF.Model, companyId: string) {
  const name = delegateName(model.name);

  if (name === 'company') {
    return { id: companyId };
  }

  if (model.fields.some((field) => field.name === 'companyId')) {
    return { companyId };
  }

  const linked = LINKED_TABLES[name];

  if (!linked) {
    throw new Error(
      `A tabela ${model.name} não tem companyId nem caminho até a empresa em ` +
        'LINKED_TABLES (company-snapshot.ts). Diga como ela pertence a uma ' +
        'empresa para que os testes de isolamento a cubram.',
    );
  }

  return linked(companyId);
}

/**
 * Todas as linhas que pertencem à empresa, tabela por tabela. A lista de
 * tabelas vem do schema do Prisma: uma tabela nova entra sozinha na foto.
 */
export async function snapshotCompany(
  prisma: PrismaService,
  companyId: string,
): Promise<CompanySnapshot> {
  const delegates = prisma as unknown as Record<string, Delegate>;
  const snapshot: CompanySnapshot = {};

  for (const model of Prisma.dmmf.datamodel.models) {
    const name = delegateName(model.name);

    snapshot[name] = await delegates[name].findMany({
      where: whereForCompany(model, companyId),
      orderBy: { id: 'asc' },
    });
  }

  return snapshot;
}

/** Ids de todas as linhas da foto + valores que identificam a empresa. */
export function fingerprintsOf(snapshot: CompanySnapshot, extra: string[]) {
  const ids = Object.values(snapshot)
    .flat()
    .map((row) => (row as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string');

  return [...new Set([...extra, ...ids])];
}
