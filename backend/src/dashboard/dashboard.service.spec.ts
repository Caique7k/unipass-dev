import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import {
  DASHBOARD_REPORT_TYPES,
  GetDashboardReportDto,
} from './dto/get-dashboard-report.dto';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
// 22:30 de 01/11 em Brasília (já é 02/11 em UTC).
const NOW = new Date('2026-11-02T01:30:00.000Z');

type PrismaCall = { model: string; method: string; args: unknown };
type Scenario = [string, (s: DashboardService) => Promise<unknown>];

// O que cada método devolve quando o teste não diz nada.
const EMPTY_RESULTS: Record<string, unknown> = {
  findMany: [],
  count: 0,
  groupBy: [],
  aggregate: { _count: { _all: 0 }, _sum: { amountCents: null } },
};

/**
 * Prisma falso que anota TODA consulta: qualquer prisma.<modelo>.<método>
 * entra em `calls`, inclusive de um modelo que o dashboard passe a usar
 * depois. `results["modelo.método"]` troca o resultado (uma lista, consumida
 * na ordem das chamadas). Consulta crua ($queryRaw...) faz o teste falhar,
 * porque ficaria fora da verificação de empresa.
 */
function buildPrisma() {
  const calls: PrismaCall[] = [];
  const results: Record<string, unknown[]> = {};

  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => {
          if (typeof method !== 'string') {
            return undefined;
          }
          return (args: unknown) => {
            calls.push({ model, method, args });
            const queued = results[`${model}.${method}`];
            const value = queued?.length
              ? queued.shift()
              : EMPTY_RESULTS[method];
            if (value === undefined) {
              throw new Error(
                `prisma.${model}.${method} sem resultado no fake`,
              );
            }
            return Promise.resolve(value);
          };
        },
      },
    );

  const prisma = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name !== 'string') {
          return undefined;
        }
        // As consultas já foram anotadas ao serem criadas.
        if (name === '$transaction') {
          return (operations: Promise<unknown>[]) => Promise.all(operations);
        }
        if (name.startsWith('$')) {
          throw new Error(
            `prisma.${name} ficaria fora da verificação de empresa`,
          );
        }
        return modelProxy(name);
      },
    },
  );

  return { prisma: prisma as unknown as PrismaService, calls, results };
}

// Um companyId aqui dentro não limita a linha principal: "OU", "NÃO", "tem
// algum/todos/nenhum filho". Por isso a busca não entra nesses operadores.
const NON_RESTRICTING_KEYS = new Set(['OR', 'NOT', 'some', 'every', 'none']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * O where limita as linhas à empresa? Vale companyId (ou { equals }) no nível
 * de cima, dentro de AND ou dentro de uma relação de um só registro
 * (route: {...}, schedule: { route: {...} }).
 *
 * Limite: confere a FORMA dos argumentos passados ao Prisma, não o SQL nem os
 * dados. Não prova que a relação usada leva à empresa certa; isso só o banco
 * de verdade prova (suíte de banco, backend/test/tenant/).
 */
function restrictsToCompany(where: unknown, companyId: string): boolean {
  if (Array.isArray(where)) {
    return where.some((condition) => restrictsToCompany(condition, companyId));
  }
  if (!isRecord(where)) {
    return false;
  }
  return Object.entries(where).some(([key, value]) => {
    if (key === 'companyId') {
      return (
        value === companyId || (isRecord(value) && value.equals === companyId)
      );
    }
    if (NON_RESTRICTING_KEYS.has(key)) {
      return false;
    }
    return restrictsToCompany(value, companyId);
  });
}

function queriesWithoutCompany(calls: PrismaCall[], companyId: string) {
  return calls
    .filter(({ args }) => {
      const where = isRecord(args) ? args.where : undefined;
      return !restrictsToCompany(where, companyId);
    })
    .map(({ model, method }) => `${model}.${method}`);
}

const whereOf = (call: PrismaCall | undefined) =>
  (call?.args as { where: Record<string, unknown> }).where;

const aggregate = (count: number, amountCents: number) => ({
  _count: { _all: count },
  _sum: { amountCents },
});

describe('DashboardService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: DashboardService;
  const config = {
    get: (key: string) =>
      key === 'APP_TIMEZONE' ? 'America/Sao_Paulo' : undefined,
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    prisma = buildPrisma();
    service = new DashboardService(prisma.prisma, config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('como o teste confere a empresa no where', () => {
    it.each([
      ['direto', { companyId: COMPANY_ID, active: true }],
      ['com equals', { companyId: { equals: COMPANY_ID } }],
      ['por uma relação', { route: { companyId: COMPANY_ID, active: true } }],
      [
        'por duas relações',
        { occurrenceKey: 'x', schedule: { route: { companyId: COMPANY_ID } } },
      ],
      ['dentro de AND', { AND: [{ active: true }, { companyId: COMPANY_ID }] }],
    ])('reconhece a empresa %s', (_case, where) => {
      expect(restrictsToCompany(where, COMPANY_ID)).toBe(true);
    });

    it.each([
      ['sem where', undefined],
      ['where vazio', {}],
      ['outra empresa', { companyId: 'outra-empresa' }],
      ['só num OR', { OR: [{ companyId: COMPANY_ID }, { id: 'x' }] }],
      ['só num NOT', { NOT: { companyId: COMPANY_ID } }],
      [
        'só em "tem algum filho"',
        { devices: { some: { companyId: COMPANY_ID } } },
      ],
    ])('não aceita %s', (_case, where) => {
      expect(restrictsToCompany(where, COMPANY_ID)).toBe(false);
    });
  });

  describe('toda consulta leva o companyId do usuário', () => {
    const ALL_FILTERS = {
      busId: 'bus-1',
      routeId: 'route-1',
      groupId: 'group-1',
      eventType: 'BOARDING',
      studentStatus: 'active',
    } satisfies GetDashboardReportDto;

    const scenarios: Scenario[] = [
      ['getMetrics como ADMIN', (s) => s.getMetrics(COMPANY_ID, 'ADMIN')],
      ['getMetrics como DRIVER', (s) => s.getMetrics(COMPANY_ID, 'DRIVER')],
      ...DASHBOARD_REPORT_TYPES.flatMap((reportType): Scenario[] => [
        [
          `relatório ${reportType} sem filtros`,
          (s) => s.getReport(COMPANY_ID, { reportType }),
        ],
        [
          `relatório ${reportType} com todos os filtros`,
          (s) => s.getReport(COMPANY_ID, { reportType, ...ALL_FILTERS }),
        ],
      ]),
    ];

    it.each(scenarios)('%s', async (_case, run) => {
      await run(service);

      expect(prisma.calls.length).toBeGreaterThan(0);
      expect(queriesWithoutCompany(prisma.calls, COMPANY_ID)).toEqual([]);
    });
  });

  describe('getMetrics — financeiro só para ADMIN', () => {
    // Se as cobranças fossem consultadas, haveria boletos vencidos para mostrar.
    const queueCharges = () => {
      prisma.results['billingCharge.aggregate'] = [
        aggregate(3, 45_000), // em aberto (a vencer)
        aggregate(2, 30_000), // vencidos
        aggregate(5, 90_000), // pagos no mês
      ];
    };

    it('ADMIN: bloco financeiro com as três somas e alerta de boletos vencidos', async () => {
      queueCharges();

      const metrics = await service.getMetrics(COMPANY_ID, 'ADMIN');

      expect(metrics.billing).toEqual({
        openCount: 3,
        openAmountCents: 45_000,
        overdueCount: 2,
        overdueAmountCents: 30_000,
        paidThisMonthCount: 5,
        paidThisMonthAmountCents: 90_000,
      });
      expect(metrics.alerts.map((alert) => alert.key)).toContain(
        'billing-overdue',
      );
      expect(
        prisma.calls.filter((call) => call.model === 'billingCharge'),
      ).toHaveLength(3);
    });

    it.each([
      ['DRIVER', 'DRIVER'],
      ['COORDINATOR', 'COORDINATOR'],
      ['papel ausente', undefined],
    ])(
      '%s: nenhum dado financeiro e nenhuma consulta de cobrança',
      async (_case, role) => {
        queueCharges();

        const metrics = await service.getMetrics(COMPANY_ID, role);

        expect(metrics.billing).toBeNull();
        expect(metrics.alerts.map((alert) => alert.key)).not.toContain(
          'billing-overdue',
        );
        expect(JSON.stringify(metrics)).not.toMatch(
          /amountCents|openCount|overdueCount|paidThisMonth/,
        );
        expect(
          prisma.calls.filter((call) => call.model === 'billingCharge'),
        ).toEqual([]);
      },
    );
  });

  describe('datas no fuso da aplicação (America/Sao_Paulo)', () => {
    it('"hoje" é o dia em Brasília: a virada é à meia-noite de lá, não de UTC', async () => {
      prisma.results['transportEvent.findMany'] = [
        // 1ª leitura: a janela de 7 dias da série.
        [
          // 22:00 de 01/11 em Brasília (02/11 em UTC): conta em 01/11.
          {
            type: 'BOARDING',
            createdAt: new Date('2026-11-02T01:00:00.000Z'),
            studentId: 's1',
          },
          // 00:00 de 01/11 em Brasília: conta em 01/11.
          {
            type: 'BOARDING',
            createdAt: new Date('2026-11-01T03:00:00.000Z'),
            studentId: 's2',
          },
          // 23:59 de 31/10 em Brasília (01/11 em UTC): conta em 31/10.
          {
            type: 'BOARDING',
            createdAt: new Date('2026-11-01T02:59:00.000Z'),
            studentId: 's3',
          },
        ],
        // 2ª leitura: eventos recentes.
        [],
      ];

      const metrics = await service.getMetrics(COMPANY_ID, 'DRIVER');

      expect(metrics.dateKey).toBe('2026-11-01');
      expect(metrics.series.at(-1)).toMatchObject({
        date: '2026-11-01',
        boardings: 2,
      });
      expect(metrics.series.at(-2)).toMatchObject({
        date: '2026-10-31',
        boardings: 1,
      });
      expect(metrics.movement.boardings).toMatchObject({
        value: 2,
        previous: 1,
      });

      // A janela vai do começo de 26/10 ao fim de 01/11, em Brasília.
      const windowQuery = prisma.calls.find(
        (call) => call.model === 'transportEvent',
      );
      expect(whereOf(windowQuery).createdAt).toEqual({
        gte: new Date('2026-10-26T03:00:00.000Z'),
        lte: new Date('2026-11-02T02:59:59.999Z'),
      });
    });

    it('o período do relatório cobre os dias inteiros em Brasília', async () => {
      const report = await service.getReport(COMPANY_ID, {
        reportType: 'boarding',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
      });

      expect(report.filters).toMatchObject({
        startDate: '2026-10-01',
        endDate: '2026-10-07',
      });
      const eventQuery = prisma.calls.find(
        (call) => call.model === 'transportEvent',
      );
      expect(whereOf(eventQuery).createdAt).toEqual({
        gte: new Date('2026-10-01T03:00:00.000Z'),
        lte: new Date('2026-10-08T02:59:59.999Z'),
      });
    });

    it('sem datas, o relatório usa os últimos 7 dias terminando hoje em Brasília', async () => {
      const report = await service.getReport(COMPANY_ID, {});

      expect(report.filters).toMatchObject({
        reportType: 'boarding',
        startDate: '2026-10-26',
        endDate: '2026-11-01',
      });
    });

    it('data inicial depois da final: 400, sem nenhuma consulta ao banco', async () => {
      await expect(
        service.getReport(COMPANY_ID, {
          startDate: '2026-10-08',
          endDate: '2026-10-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.calls).toEqual([]);
    });

    it('filtro "all" vale como sem filtro', async () => {
      const report = await service.getReport(COMPANY_ID, {
        reportType: 'boarding',
        busId: 'all',
        routeId: ' all ',
        groupId: 'all',
      });

      expect(report.filters).toMatchObject({
        busId: null,
        routeId: null,
        groupId: null,
      });
      const eventWhere = whereOf(
        prisma.calls.find((call) => call.model === 'transportEvent'),
      );
      expect(eventWhere).not.toHaveProperty('device');
      expect(eventWhere).not.toHaveProperty('student');
    });
  });
});
