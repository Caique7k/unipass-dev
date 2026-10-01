import { UserRole } from '@prisma/client';
import { CreateUserDto } from 'src/users/dto/create-user.dto';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * Usuários (logins da empresa): a empresa A nunca lista, altera (inclusive a
 * senha) nem desativa um usuário de B ou o dono da plataforma, nem cria ou
 * edita um usuário dela ligado a aluno ou e-mail de B.
 */
describe('Isolamento entre empresas — usuários', () => {
  const ctx = useTwoCompanies();
  const users = () => ctx.services.users;
  // O usuário logado, no formato que o JwtStrategy entrega em req.user.
  const adminA = () => ({
    id: ctx.a.users.admin.id,
    role: ctx.a.users.admin.role,
    companyId: ctx.a.companyId,
  });
  const nothingChanges = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(
      ctx.prisma,
      [ctx.a.companyId, ctx.b.companyId],
      action,
    );
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

  describe('leitura', () => {
    it('a lista de A traz os usuários de A e ninguém de B nem da plataforma', async () => {
      const result = await users().findAll(adminA(), { page: 1, limit: 100 });

      expect(result.data.map((user) => user.id).sort()).toEqual(
        [
          ctx.a.users.admin.id,
          ctx.a.users.driver.id,
          ctx.a.users.parent.id,
        ].sort(),
      );
      expectNoDataFrom(result, ctx.b);
      expect(JSON.stringify(result)).not.toContain(ctx.platformAdmin.id);
    });

    it('buscar por nome, e-mail ou domínio de B não acha ninguém', async () => {
      const search = (term: string) =>
        users().findAll(adminA(), { search: term, page: 1, limit: 100 });

      for (const term of [
        ctx.b.users.admin.name,
        ctx.b.users.parent.email,
        'bravo.test',
      ]) {
        await expect(search(term)).resolves.toMatchObject({
          data: [],
          total: 0,
        });
      }
      await expect(search(ctx.a.users.admin.name)).resolves.toMatchObject({
        total: 1,
      });
    });

    it('buscar e filtrar por papel só traz usuários de A', async () => {
      const byRoleSearch = await users().findAll(adminA(), {
        search: 'ADMIN',
        page: 1,
        limit: 100,
      });
      const byRoleFilter = await users().findAll(adminA(), {
        role: 'USER',
        page: 1,
        limit: 100,
      });

      expect(byRoleSearch.data.map((user) => user.id)).toEqual([
        ctx.a.users.admin.id,
      ]);
      expect(byRoleFilter.data.map((user) => user.id)).toEqual([
        ctx.a.users.parent.id,
      ]);
      expectNoDataFrom([byRoleSearch, byRoleFilter], ctx.b);
    });
  });

  describe('escrita em usuário de B', () => {
    it('trocar a senha, o nome e o papel dá 404 e o hash de B fica igual', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().update(adminA(), ctx.b.users.admin.id, {
            password: 'senha-invasora',
            name: 'Invadido',
            role: UserRole.DRIVER,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });

    // O status fica fixo em 404 ("não existe na sua empresa"): outro 4xx pode
    // vir de uma checagem posterior e esconder que o usuário de B foi achado.
    it('desativar pela edição dá 404', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().update(adminA(), ctx.b.users.driver.id, { active: false }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('desativar em lote dá 404', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().deactivateMany(adminA(), [ctx.b.users.driver.id]),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });
  });

  describe('lote misto [A, B]', () => {
    it('desativar só desativa o usuário de A', async () => {
      const result = await bUnchanged(() =>
        users().deactivateMany(adminA(), [
          ctx.a.users.driver.id,
          ctx.b.users.driver.id,
        ]),
      );

      expect(result.count).toBe(1);
      await expect(
        ctx.prisma.user.findUniqueOrThrow({
          where: { id: ctx.a.users.driver.id },
        }),
      ).resolves.toMatchObject({ active: false });
    });
  });

  describe('dono da plataforma (fora das empresas)', () => {
    it('A não edita a senha nem desativa o PLATFORM_ADMIN', async () => {
      const platformAdmin = () =>
        ctx.prisma.user.findUniqueOrThrow({
          where: { id: ctx.platformAdmin.id },
        });
      const before = await platformAdmin();

      await nothingChanges(async () => {
        await expectClientError(
          users().update(adminA(), ctx.platformAdmin.id, {
            password: 'senha-invasora',
            name: 'Invadido',
          }),
        );
        await expectClientError(
          users().deactivateMany(adminA(), [ctx.platformAdmin.id]),
        );
      });

      await expect(platformAdmin()).resolves.toEqual(before);
    });
  });

  describe('usuário de A apontando para dados de B', () => {
    const newUser = (overrides: Partial<CreateUserDto>): CreateUserDto => ({
      role: UserRole.DRIVER,
      name: 'Motorista Novo Alfa',
      email: 'novo@alfa.test',
      password: '123456',
      ...overrides,
    });

    it('ligar um usuário novo a um aluno da própria empresa funciona (controle)', async () => {
      const created = await users().create(
        adminA(),
        newUser({ role: UserRole.USER, studentId: ctx.a.spareStudent.id }),
      );

      expect(created).toMatchObject({ studentId: ctx.a.spareStudent.id });
      expectNoDataFrom(created, ctx.b);
    });

    it('criar usuário ligado a um aluno de B dá 400 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().create(
            adminA(),
            newUser({ role: UserRole.USER, studentId: ctx.b.student.id }),
          ),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('criar usuário com e-mail do domínio de B dá 400 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().create(adminA(), newUser({ email: 'novo@bravo.test' })),
        ),
      );

      expect(error.getStatus()).toBe(400);
    });

    it('editar usuário de A para ligar a um aluno de B dá 400 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().update(adminA(), ctx.a.users.parent.id, {
            studentId: ctx.b.student.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('editar o e-mail de um usuário de A para o de um usuário de B dá 400', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          users().update(adminA(), ctx.a.users.driver.id, {
            email: ctx.b.users.driver.email,
          }),
        ),
      );

      // Recusado pelo domínio, sem dizer se o e-mail existe em B.
      expect(error.getStatus()).toBe(400);
      expect(error.message).not.toContain('já');
    });
  });

  describe('sem empresa (companyId nulo, como o PLATFORM_ADMIN)', () => {
    const noCompany = () => ({
      id: ctx.platformAdmin.id,
      role: UserRole.PLATFORM_ADMIN,
      companyId: null,
    });

    it('listar devolve vazio', async () => {
      const result = await users().findAll(noCompany(), {
        page: 1,
        limit: 100,
      });

      expect(result).toMatchObject({ data: [], total: 0 });
    });

    it('criar, editar e desativar são recusados sem mexer em ninguém', async () => {
      await nothingChanges(async () => {
        await expectClientError(
          users().create(noCompany(), {
            role: UserRole.DRIVER,
            name: 'Motorista Sem Empresa',
            email: 'novo@bravo.test',
            password: '123456',
          }),
        );
        await expectClientError(
          users().update(noCompany(), ctx.b.users.driver.id, {
            name: 'Invadido',
          }),
        );
        await expectClientError(
          users().deactivateMany(noCompany(), [
            ctx.a.users.driver.id,
            ctx.b.users.driver.id,
          ]),
        );
      });
    });
  });
});
