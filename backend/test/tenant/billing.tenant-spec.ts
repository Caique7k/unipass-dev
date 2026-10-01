import { BillingOnboardingStatus, UserRole } from '@prisma/client';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
  expectNoDataFromAnyCompany,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * Financeiro (boletos, dados do pagador, documento e dados bancários): a
 * empresa A nunca vê, emite, altera ou desativa nada da empresa B.
 */
describe('Isolamento entre empresas — financeiro', () => {
  const ctx = useTwoCompanies();
  const billing = () => ctx.services.billing;
  const templates = () => ctx.services.billingTemplates;
  const adminA = () => ({
    companyId: ctx.a.companyId,
    userId: ctx.a.users.admin.id,
    role: UserRole.ADMIN,
  });
  const parentA = () => ({
    companyId: ctx.a.companyId,
    userId: ctx.a.users.parent.id,
    role: UserRole.USER,
  });
  const nothingChanges = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(
      ctx.prisma,
      [ctx.a.companyId, ctx.b.companyId],
      action,
    );
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);
  // Um mês sem nenhuma cobrança na fixture (a dela é de setembro/2026).
  const DECEMBER = { referenceMonth: '2026-12', issueDate: '2026-12-01' };

  describe('cobranças e visão geral', () => {
    it('a visão geral do admin de A só tem cobranças e configuração de A', async () => {
      const overview = await billing().getOverview(adminA());

      expect(overview.charges.map((charge) => charge.id)).toEqual([
        ctx.a.charge.id,
      ]);
      expect(overview.settings.legalDocument).toBe(ctx.a.cnpj);
      expectNoDataFrom(overview, ctx.b);
    });

    it('a visão geral do responsável de A só tem a cobrança dele', async () => {
      const overview = await billing().getOverview(parentA());

      expect(overview.charges.map((charge) => charge.id)).toEqual([
        ctx.a.charge.id,
      ]);
      expectNoDataFrom(overview, ctx.b);
    });

    it('a lista de cobranças de A não traz nada de B', async () => {
      const result = await billing().findCharges({ ...adminA(), limit: 50 });

      expect(result.data.map((charge) => charge.id)).toEqual([ctx.a.charge.id]);
      expectNoDataFrom(result, ctx.b);
    });

    it('filtrar pelo grupo de boletos de B ou buscar por dados de B não acha nada', async () => {
      const find = (filters: { search?: string; templateId?: string }) =>
        billing().findCharges({ ...adminA(), limit: 50, ...filters });

      await expect(
        find({ templateId: ctx.b.billingTemplate.id }),
      ).resolves.toMatchObject({ data: [], total: 0 });

      // A fixture sempre preenche esses campos; busca vazia traria tudo.
      for (const search of [
        ctx.b.charge.recipientName,
        ctx.b.student.name,
        ctx.b.customerDocument,
        ctx.b.charge.externalReference as string,
        ctx.b.billingCustomer.email as string,
      ]) {
        expect(search).toBeTruthy();
        await expect(find({ search })).resolves.toMatchObject({
          data: [],
          total: 0,
        });
      }

      await expect(
        find({ search: ctx.a.charge.externalReference as string }),
      ).resolves.toMatchObject({ total: 1 });
    });

    it('o responsável de A não vê cobrança de B nem pedindo o grupo de B', async () => {
      const result = await billing().findCharges({
        ...parentA(),
        limit: 50,
        templateId: ctx.b.billingTemplate.id,
      });

      expect(result).toMatchObject({ data: [], total: 0 });
      expectNoDataFrom(result, ctx.b);
    });
  });

  describe('emissão e configuração', () => {
    it('emitir com o grupo de boletos de B dá 400 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          billing().issueCharges(ctx.a.companyId, {
            ...DECEMBER,
            templateId: ctx.b.billingTemplate.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('emitir em lote só cobra alunos de A', async () => {
      const result = await bUnchanged(() =>
        billing().issueCharges(ctx.a.companyId, DECEMBER),
      );

      expect(result.created.map((charge) => charge.studentName)).toEqual([
        ctx.a.student.name,
      ]);
      expectNoDataFrom(result, ctx.b);
      await expect(
        ctx.prisma.billingCharge.count({
          where: { companyId: ctx.a.companyId },
        }),
      ).resolves.toBe(2);
    });

    it('alterar a configuração financeira de A não mexe na de B', async () => {
      const settings = await bUnchanged(() =>
        billing().updateCompanySettings(ctx.a.companyId, {
          legalEntityName: 'Nova Razão Alfa',
          bankInfoSummary: 'Novo Banco Alfa',
        }),
      );

      expect(settings.legalEntityName).toBe('Nova Razão Alfa');
      expectNoDataFrom(settings, ctx.b);
    });

    it('enviar o onboarding de A não mexe no de B', async () => {
      const settings = await bUnchanged(async () => {
        await billing().updateCompanySettings(ctx.a.companyId, {
          usePlatformGateway: true,
          lgpdAccepted: true,
          platformTermsAccepted: true,
        });

        return billing().submitOnboarding(ctx.a.companyId);
      });

      expect(settings.onboardingStatus).toBe(
        BillingOnboardingStatus.UNDER_REVIEW,
      );
      expectNoDataFrom(settings, ctx.b);
    });
  });

  describe('grupos de boletos', () => {
    it('a lista de A traz o grupo de A e nenhum de B', async () => {
      const result = await templates().findAll({
        companyId: ctx.a.companyId,
        page: 1,
        limit: 100,
      });

      expect(result.data.map((template) => template.id)).toEqual([
        ctx.a.billingTemplate.id,
      ]);
      expect(result.data[0]._count.students).toBe(1);
      expectNoDataFrom(result, ctx.b);
    });

    it('buscar pelo nome de um grupo de B não acha nada', async () => {
      const search = (term: string) =>
        templates().findAll({
          companyId: ctx.a.companyId,
          page: 1,
          limit: 100,
          search: term,
        });

      await expect(search(ctx.b.billingTemplate.name)).resolves.toMatchObject({
        data: [],
        total: 0,
      });
      await expect(search(ctx.a.billingTemplate.name)).resolves.toMatchObject({
        total: 1,
      });
    });

    it('abrir o grupo de A funciona; o de B dá 404 sem dado de B no erro', async () => {
      const own = await templates().findOne(
        ctx.a.companyId,
        ctx.a.billingTemplate.id,
      );
      const error = await expectClientError(
        templates().findOne(ctx.a.companyId, ctx.b.billingTemplate.id),
      );

      expect(own.id).toBe(ctx.a.billingTemplate.id);
      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });

    it('editar um grupo de B dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          templates().update(ctx.a.companyId, ctx.b.billingTemplate.id, {
            amountCents: 1,
            active: false,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('desativar um grupo de B dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          templates().deactivateMany(ctx.a.companyId, [
            ctx.b.billingTemplate.id,
          ]),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('lote misto [A, B]: só o grupo de A é desativado', async () => {
      const result = await bUnchanged(() =>
        templates().deactivateMany(ctx.a.companyId, [
          ctx.a.billingTemplate.id,
          ctx.b.billingTemplate.id,
        ]),
      );

      expect(result.count).toBe(1);
      await expect(
        ctx.prisma.billingTemplate.findUniqueOrThrow({
          where: { id: ctx.a.billingTemplate.id },
        }),
      ).resolves.toMatchObject({ active: false });
    });
  });

  describe('sem empresa (companyId nulo, como o PLATFORM_ADMIN)', () => {
    const noCompany = null as unknown as string;
    const platformUser = () => ({
      companyId: null,
      userId: ctx.platformAdmin.id,
      role: UserRole.PLATFORM_ADMIN,
    });

    it('visão geral, cobranças, emissão, configuração e onboarding são recusados', async () => {
      await nothingChanges(async () => {
        await expectClientError(billing().getOverview(platformUser()));
        await expectClientError(billing().findCharges(platformUser()));
        await expectClientError(billing().issueCharges(null, DECEMBER));
        await expectClientError(
          billing().updateCompanySettings(null, { legalEntityName: 'X' }),
        );
        await expectClientError(billing().submitOnboarding(null));
      });
    });

    it('grupos de boletos não devolvem nem mexem em empresa nenhuma', async () => {
      const tenants = [ctx.a, ctx.b];

      await nothingChanges(async () => {
        await expectNoDataFromAnyCompany(
          () =>
            templates().findAll({ companyId: noCompany, page: 1, limit: 100 }),
          tenants,
        );
        await expectNoDataFromAnyCompany(
          () => templates().findOne(noCompany, ctx.b.billingTemplate.id),
          tenants,
        );
        await expectNoDataFromAnyCompany(
          () =>
            templates().deactivateMany(noCompany, [
              ctx.a.billingTemplate.id,
              ctx.b.billingTemplate.id,
            ]),
          tenants,
        );
      });
    });
  });
});
