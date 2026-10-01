import { BadRequestException, NotFoundException } from '@nestjs/common';
import { snapshotCompany } from './support/company-snapshot';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';
import { assertTestDatabaseUrl } from './support/test-database';

// Nenhum serviço cria Trip hoje, e BillingEventLog só nasce do webhook do ASAAS.
const TABLES_EMPTY_BY_DESIGN = ['billingEventLog', 'trip'];

/**
 * Testa as ferramentas dos testes de isolamento. Se o canário ou a foto
 * deixassem passar um vazamento, todos os outros testes passariam "no vazio".
 */
describe('Harness dos testes de isolamento entre empresas', () => {
  const ctx = useTwoCompanies();

  describe('trava do banco de teste', () => {
    it.each([
      ['o banco de dev', 'postgresql://u:p@postgres:5432/unipass_db'],
      ['outro banco no host de teste', 'postgresql://u:p@postgres-test:5432/x'],
      [
        'o Postgres do Windows na 5433',
        'postgresql://u:p@localhost:5433/unipass_test',
      ],
      ['DATABASE_URL vazia', undefined],
    ])('recusa %s', (_label, url) => {
      expect(() => assertTestDatabaseUrl(url)).toThrow('Recusando rodar');
    });

    it('aceita só o banco descartável e está conectado nele', async () => {
      expect(() =>
        assertTestDatabaseUrl(
          'postgresql://u:p@postgres-test:5432/unipass_test',
        ),
      ).not.toThrow();

      const [row] = await ctx.prisma.$queryRaw<
        { database: string }[]
      >`SELECT current_database() AS database`;
      expect(row.database).toBe('unipass_test');
    });
  });

  describe('fixture', () => {
    it('as duas empresas têm o mesmo formato, sem tabela vazia por engano', async () => {
      const count = async (companyId: string) =>
        Object.fromEntries(
          Object.entries(await snapshotCompany(ctx.prisma, companyId)).map(
            ([table, rows]) => [table, rows.length],
          ),
        );
      const [countA, countB] = await Promise.all([
        count(ctx.a.companyId),
        count(ctx.b.companyId),
      ]);

      expect(countB).toEqual(countA);
      expect(
        Object.keys(countA)
          .filter((table) => countA[table] === 0)
          .sort(),
      ).toEqual(TABLES_EMPTY_BY_DESIGN);
    });

    it('nenhum dado de uma empresa carrega impressão digital da outra', async () => {
      const [a, b] = await Promise.all([
        snapshotCompany(ctx.prisma, ctx.a.companyId),
        snapshotCompany(ctx.prisma, ctx.b.companyId),
      ]);

      expectNoDataFrom(a, ctx.b);
      expectNoDataFrom(b, ctx.a);
    });
  });

  describe('canário', () => {
    it('acusa um dado de B escondido num campo aninhado', () => {
      const planted = {
        data: [
          {
            id: ctx.a.student.id,
            group: { students: [{ name: ctx.b.student.name }] },
          },
        ],
      };

      expect(() => expectNoDataFrom(planted, ctx.b)).toThrow('Vazamento');
    });

    it('acusa só o id de uma linha de B', () => {
      expect(() => expectNoDataFrom({ busId: ctx.b.bus.id }, ctx.b)).toThrow(
        ctx.b.bus.id,
      );
    });

    it('acusa dado de B dentro da mensagem de um erro', () => {
      const error = new BadRequestException(
        `TAG já vinculada ao aluno ${ctx.b.student.name}.`,
      );

      expect(() => expectNoDataFrom(error, ctx.b)).toThrow('Vazamento');
    });

    it('acusa uma consulta real feita sem filtro de empresa', async () => {
      // Exatamente o erro que esta suíte existe para pegar: esquecer o companyId.
      const everyone = await ctx.prisma.student.findMany({
        include: { group: true },
      });

      expect(() => expectNoDataFrom(everyone, ctx.b)).toThrow('Vazamento');
    });

    it('não acusa os dados da própria empresa', async () => {
      const own = await ctx.prisma.student.findMany({
        where: { companyId: ctx.a.companyId },
        include: { group: true, rfidCards: true, routes: true },
      });

      expect(own).toHaveLength(2);
      expectNoDataFrom(own, ctx.b);
    });
  });

  describe('foto da empresa', () => {
    const expectBUnchanged = (action: () => Promise<unknown>) =>
      expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

    it('acusa alteração numa tabela com companyId', async () => {
      await expect(
        expectBUnchanged(() =>
          ctx.prisma.student.update({
            where: { id: ctx.b.student.id },
            data: { name: 'Alterado' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('acusa alteração numa tabela ligada à empresa só por relação', async () => {
      await expect(
        expectBUnchanged(() =>
          ctx.prisma.routeSchedule.update({
            where: { id: ctx.b.schedule.id },
            data: { title: 'Alterado' },
          }),
        ),
      ).rejects.toThrow();
    });

    it('acusa linha nova', async () => {
      await expect(
        expectBUnchanged(() =>
          ctx.prisma.group.create({
            data: {
              companyId: ctx.b.companyId,
              name: 'Nova',
              nameNormalized: 'nova',
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('não acusa nada quando só a empresa A muda', async () => {
      await expectBUnchanged(() =>
        ctx.prisma.student.update({
          where: { id: ctx.a.student.id },
          data: { name: 'Aluno Alfa Editado' },
        }),
      );
    });
  });

  describe('expectClientError', () => {
    it('aceita erro 4xx', async () => {
      await expect(
        expectClientError(Promise.reject(new NotFoundException())),
      ).resolves.toBeInstanceOf(NotFoundException);
    });

    it('recusa quando a chamada funciona', async () => {
      await expect(
        expectClientError(Promise.resolve({ ok: true })),
      ).rejects.toThrow('Esperava um erro 4xx');
    });

    it('recusa erro que não é 4xx (500, erro do Prisma)', async () => {
      await expect(
        expectClientError(Promise.reject(new Error('falha interna'))),
      ).rejects.toThrow('falha interna');
    });
  });
});
