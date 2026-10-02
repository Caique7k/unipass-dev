import { CreateStudentDto } from 'src/students/dto/create-student.dto';
import { UpdateStudentDto } from 'src/students/dto/update-student.dto';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
  expectNoDataFromAnyCompany,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * Alunos (dados de menores): a empresa A nunca lê, altera ou apaga um aluno
 * da empresa B, nem liga um aluno dela a grupo, rota, boleto ou TAG de B.
 */
describe('Isolamento entre empresas — alunos', () => {
  const ctx = useTwoCompanies();
  const students = () => ctx.services.students;
  const nothingChanges = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(
      ctx.prisma,
      [ctx.a.companyId, ctx.b.companyId],
      action,
    );
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

  describe('leitura', () => {
    it('a lista de A traz os alunos de A e nenhum de B', async () => {
      const result = await students().findAll({
        companyId: ctx.a.companyId,
        page: 1,
        limit: 100,
      });

      expect(result.data.map((student) => student.id).sort()).toEqual(
        [ctx.a.student.id, ctx.a.spareStudent.id].sort(),
      );
      expectNoDataFrom(result, ctx.b);
    });

    it('buscar pelo nome de um aluno de B não acha nada', async () => {
      const search = (term: string) =>
        students().findAll({
          companyId: ctx.a.companyId,
          page: 1,
          limit: 100,
          search: term,
        });

      await expect(search(ctx.b.student.name)).resolves.toMatchObject({
        data: [],
        total: 0,
      });
      await expect(search(ctx.a.student.name)).resolves.toMatchObject({
        total: 1,
      });
    });

    it('abrir o próprio aluno traz os dados aninhados dele, sem nada de B', async () => {
      const own = await students().findOne(ctx.a.companyId, ctx.a.student.id);

      expect(own.id).toBe(ctx.a.student.id);
      expect(own.rfidCards).toHaveLength(1);
      expect(own.billingCustomer?.id).toBe(ctx.a.billingCustomer.id);
      expectNoDataFrom(own, ctx.b);
    });

    it('abrir um aluno de B pelo id dá 404, sem dado de B no erro', async () => {
      const error = await expectClientError(
        students().findOne(ctx.a.companyId, ctx.b.student.id),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });

    it('candidatos a usuário com o id de um usuário de B não trazem nada de B', async () => {
      const candidates = await students().findUserCandidates(
        ctx.a.companyId,
        ctx.b.users.parent.id,
      );

      // O aluno principal de A já tem usuário; sobra o avulso.
      expect(candidates.map((student) => student.id)).toEqual([
        ctx.a.spareStudent.id,
      ]);
      expectNoDataFrom(candidates, ctx.b);
    });
  });

  // O status fica fixo em 404 ("não existe na sua empresa"): outro 4xx pode
  // significar que o aluno de B foi achado e recusado depois — e só isso já
  // revela que o id existe em outra empresa.
  describe('escrita em aluno de B', () => {
    it('editar dá 404 e nenhuma das duas empresas muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          students().update(ctx.a.companyId, ctx.b.student.id, {
            name: 'Invadido',
            active: false,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('desativar dá 404; o aluno e a TAG de B continuam ativos', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          students().desactivateMany(ctx.a.companyId, [ctx.b.student.id]),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('excluir não exclui ninguém', async () => {
      const result = await nothingChanges(() =>
        students().deleteMany(ctx.a.companyId, [ctx.b.spareStudent.id]),
      );

      expect(result.count).toBe(0);
    });
  });

  describe('lote misto [A, B]', () => {
    it('desativar só desativa o aluno de A (e só a TAG dele é liberada)', async () => {
      const result = await bUnchanged(() =>
        students().desactivateMany(ctx.a.companyId, [
          ctx.a.student.id,
          ctx.b.student.id,
        ]),
      );

      expect(result.count).toBe(1);
      const own = await ctx.prisma.student.findUniqueOrThrow({
        where: { id: ctx.a.student.id },
        include: { rfidCards: true },
      });
      expect(own.active).toBe(false);
      expect(own.rfidCards.map((card) => card.active)).toEqual([false]);
    });

    it('excluir só exclui o aluno de A', async () => {
      const result = await bUnchanged(() =>
        students().deleteMany(ctx.a.companyId, [
          ctx.a.spareStudent.id,
          ctx.b.spareStudent.id,
        ]),
      );

      expect(result.count).toBe(1);
      await expect(
        ctx.prisma.student.findUnique({ where: { id: ctx.a.spareStudent.id } }),
      ).resolves.toBeNull();
    });
  });

  describe('aluno de A apontando para dados de B', () => {
    const newStudent = (
      overrides: Partial<CreateStudentDto>,
    ): CreateStudentDto => ({
      name: 'Aluno Novo Alfa',
      registration: 'ALFA-100',
      groupId: ctx.a.group.id,
      billingTemplateId: ctx.a.billingTemplate.id,
      routeIds: [ctx.a.route.id],
      ...overrides,
    });

    it('com as referências da própria empresa, criar funciona (controle)', async () => {
      const created = await students().create(
        ctx.a.companyId,
        newStudent({ rfidTag: 'AA00AA99' }),
      );

      expect(created.companyId).toBe(ctx.a.companyId);
      expect(created.rfidCards.map((card) => card.tag)).toEqual(['AA00AA99']);
      expectNoDataFrom(created, ctx.b);
    });

    const foreignReferences: Array<
      [string, () => Partial<CreateStudentDto> & UpdateStudentDto]
    > = [
      ['grupo', () => ({ groupId: ctx.b.group.id })],
      [
        'grupo de boletos',
        () => ({ billingTemplateId: ctx.b.billingTemplate.id }),
      ],
      ['rota', () => ({ routeIds: [ctx.b.route.id] })],
      [
        'rota de B junto com uma de A',
        () => ({ routeIds: [ctx.a.route.id, ctx.b.route.id] }),
      ],
    ];

    it.each(foreignReferences)(
      'criar com %s de B dá 400 e nada muda',
      async (_label, overrides) => {
        const error = await nothingChanges(() =>
          expectClientError(
            students().create(ctx.a.companyId, newStudent(overrides())),
          ),
        );

        expect(error.getStatus()).toBe(400);
        expectNoDataFrom(error, ctx.b);
      },
    );

    it('criar com a TAG de um aluno de B dá 400 sem dizer de quem é', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          students().create(
            ctx.a.companyId,
            newStudent({ rfidTag: ctx.b.rfidTag }),
          ),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it.each(foreignReferences)(
      'editar o aluno de A para %s de B dá 400 e nada muda',
      async (_label, overrides) => {
        const error = await nothingChanges(() =>
          expectClientError(
            students().update(ctx.a.companyId, ctx.a.student.id, overrides()),
          ),
        );

        expect(error.getStatus()).toBe(400);
        expectNoDataFrom(error, ctx.b);
      },
    );
  });

  describe('sem empresa (companyId nulo, como o PLATFORM_ADMIN)', () => {
    // As rotas de alunos exigem ADMIN/DRIVER/COORDINATOR; aqui é a última linha:
    // o service, chamado sem empresa, não pode devolver nem mexer em ninguém.
    const noCompany = null as unknown as string;

    it('listar, abrir e buscar candidatos não devolvem dado de empresa nenhuma', async () => {
      const tenants = [ctx.a, ctx.b];

      await expectNoDataFromAnyCompany(
        () => students().findAll({ companyId: noCompany, page: 1, limit: 100 }),
        tenants,
      );
      await expectNoDataFromAnyCompany(
        () => students().findOne(noCompany, ctx.b.student.id),
        tenants,
      );
      await expectNoDataFromAnyCompany(
        () => students().findUserCandidates(noCompany),
        tenants,
      );
    });

    it('desativar e excluir não mexem em empresa nenhuma', async () => {
      const ids = [ctx.a.spareStudent.id, ctx.b.spareStudent.id];

      await nothingChanges(async () => {
        await expectNoDataFromAnyCompany(
          () => students().desactivateMany(noCompany, ids),
          [ctx.a, ctx.b],
        );
        await expectNoDataFromAnyCompany(
          () => students().deleteMany(noCompany, ids),
          [ctx.a, ctx.b],
        );
      });
    });
  });
});
