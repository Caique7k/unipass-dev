import { BillingGatewayMode, UserRole } from '@prisma/client';
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
      expect(overview.gateway).toBe(BillingGatewayMode.EXTERNAL);
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
  });

  describe('gateway de cobrança (Asaas da própria empresa)', () => {
    const gateway = () => ctx.services.billingGateway;
    const asaas = () => ctx.services.asaas;
    const KEY_A = '$aact_hmlg_chave_de_teste_da_empresa_alfa_0001';
    const KEY_B = '$aact_hmlg_chave_de_teste_da_empresa_bravo_0002';
    const actorOf = (tenant: typeof ctx.a) => ({
      id: tenant.users.admin.id,
      email: tenant.users.admin.email,
      companyId: tenant.companyId,
      ip: null,
    });
    // B com Asaas completo: chave salva e testada, webhook configurado.
    const configureB = async () => {
      await gateway().setGateway(actorOf(ctx.b), BillingGatewayMode.ASAAS);
      await gateway().saveCredentials(actorOf(ctx.b), KEY_B);
      const { webhookSetup } = await gateway().configureWebhook(actorOf(ctx.b));
      asaas().reset();
      return webhookSetup;
    };

    it('a configuração de A não traz nada de B e nunca devolve chave', async () => {
      await configureB();
      await gateway().saveCredentials(actorOf(ctx.a), KEY_A);
      const view = await gateway().getGateway(ctx.a.companyId);
      const text = JSON.stringify(view);

      expect(view.asaas.apiKeyLast4).toBe(KEY_A.slice(-4));
      expect(text).not.toContain(KEY_A);
      expect(text).not.toContain(KEY_B);
      expect(text).not.toContain(KEY_B.slice(-4));
      expectNoDataFrom(view, ctx.b);
    });

    it('a chave fica cifrada no banco e o webhook guarda só o hash do token', async () => {
      const webhookSetup = await configureB();
      const stored = await ctx.prisma.companyBillingSettings.findUniqueOrThrow({
        where: { companyId: ctx.b.companyId },
      });

      expect(stored.asaasApiKeyEncrypted).toBeTruthy();
      expect(stored.asaasApiKeyEncrypted).not.toContain(KEY_B);
      expect(stored.asaasWebhookTokenHash).not.toBe(webhookSetup.authToken);
      expect(JSON.stringify(stored)).not.toContain(
        webhookSetup.authToken as string,
      );
    });

    it('salvar, testar, configurar webhook e remover em A não mexe em B nem usa a chave de B', async () => {
      await configureB();

      await bUnchanged(async () => {
        await gateway().setGateway(actorOf(ctx.a), BillingGatewayMode.ASAAS);
        await gateway().saveCredentials(actorOf(ctx.a), KEY_A);
        await gateway().testConnection(actorOf(ctx.a));
        await gateway().configureWebhook(actorOf(ctx.a));
        await gateway().removeCredentials(actorOf(ctx.a));
      });

      expect(asaas().keysUsed).not.toContain(KEY_B);
      expect(asaas().keysUsed.every((key) => key === KEY_A)).toBe(true);
    });

    it('testar a conexão em A sem chave dá 400 mesmo com B configurada', async () => {
      await configureB();

      const error = await nothingChanges(() =>
        expectClientError(gateway().testConnection(actorOf(ctx.a))),
      );

      expect(error.getStatus()).toBe(400);
      expect(asaas().keysUsed).toEqual([]);
      expectNoDataFrom(error, ctx.b);
    });

    it('a auditoria de A fica em A e sem a chave', async () => {
      await gateway().saveCredentials(actorOf(ctx.a), KEY_A);
      const logs = await ctx.prisma.billingEventLog.findMany({
        where: { source: 'MANUAL' },
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.companyId === ctx.a.companyId)).toBe(true);
      expect(JSON.stringify(logs)).not.toContain(KEY_A);
    });
  });

  describe('webhook do Asaas por empresa', () => {
    const gateway = () => ctx.services.billingGateway;
    const receiver = () => ctx.services.billingWebhookReceiver;
    const actorOf = (tenant: typeof ctx.a) => ({
      id: tenant.users.admin.id,
      email: tenant.users.admin.email,
      companyId: tenant.companyId,
      ip: null,
    });
    const setupWebhook = async (tenant: typeof ctx.a) => {
      await gateway().saveCredentials(
        actorOf(tenant),
        `$aact_hmlg_chave_de_teste_${tenant.companyId.replace(/-/g, '')}`,
      );
      const { webhookSetup } = await gateway().configureWebhook(
        actorOf(tenant),
      );
      const endpointKey = webhookSetup.path.split('/').pop() as string;
      return { endpointKey, token: webhookSetup.authToken as string };
    };
    const send = (
      endpoint: { endpointKey: string; token: string },
      payload: Record<string, unknown>,
    ) =>
      receiver().handleCompanyAsaasWebhook({
        endpointKey: endpoint.endpointKey,
        payload,
        headers: { 'asaas-access-token': endpoint.token },
        remoteIp: '127.0.0.1',
      });

    it('pagamento recebido na URL de A com o id da cobrança de B não altera B', async () => {
      await ctx.prisma.billingCharge.update({
        where: { id: ctx.b.charge.id },
        data: { gatewayChargeId: 'pay_bravo_1' },
      });
      const endpointA = await setupWebhook(ctx.a);

      await bUnchanged(async () => {
        await send(endpointA, {
          id: 'evt_cross_1',
          event: 'PAYMENT_RECEIVED',
          dateCreated: '2026-10-06 10:00:00',
          payment: {
            id: 'pay_bravo_1',
            status: 'RECEIVED',
            externalReference: ctx.b.charge.externalReference,
            paymentDate: '2026-10-06',
          },
        });
        const log = await ctx.prisma.billingEventLog.findFirstOrThrow({
          where: { source: 'WEBHOOK' },
        });
        await receiver().processWebhookEventLog(log.id);
      });

      const log = await ctx.prisma.billingEventLog.findFirstOrThrow({
        where: { source: 'WEBHOOK' },
      });
      expect(log.companyId).toBe(ctx.a.companyId);
      expect(log.chargeId).toBeNull();
    });

    it('o token de A na URL de B dá 401 e nada é gravado', async () => {
      const endpointA = await setupWebhook(ctx.a);
      const endpointB = await setupWebhook(ctx.b);

      const error = await nothingChanges(() =>
        expectClientError(
          send(
            { endpointKey: endpointB.endpointKey, token: endpointA.token },
            { id: 'evt_x', event: 'PAYMENT_RECEIVED', payment: {} },
          ),
        ),
      );

      expect(error.getStatus()).toBe(401);
    });

    it('pagamento recebido na URL de A atualiza só a cobrança de A', async () => {
      await ctx.prisma.billingCharge.update({
        where: { id: ctx.a.charge.id },
        data: { gatewayChargeId: 'pay_alfa_1' },
      });
      const endpointA = await setupWebhook(ctx.a);

      await bUnchanged(async () => {
        await send(endpointA, {
          id: 'evt_alfa_1',
          event: 'PAYMENT_RECEIVED',
          dateCreated: '2026-10-06 10:00:00',
          payment: {
            id: 'pay_alfa_1',
            status: 'RECEIVED',
            paymentDate: '2026-10-06',
          },
        });
        const log = await ctx.prisma.billingEventLog.findFirstOrThrow({
          where: { source: 'WEBHOOK' },
        });
        await receiver().processWebhookEventLog(log.id);
      });

      await expect(
        ctx.prisma.billingCharge.findUniqueOrThrow({
          where: { id: ctx.a.charge.id },
        }),
      ).resolves.toMatchObject({ status: 'PAID' });
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

    it('visão geral, cobranças, emissão e gateway são recusados', async () => {
      const gateway = ctx.services.billingGateway;
      const noCompanyActor = {
        id: ctx.platformAdmin.id,
        email: ctx.platformAdmin.email,
        companyId: null,
        ip: null,
      };

      await nothingChanges(async () => {
        await expectClientError(billing().getOverview(platformUser()));
        await expectClientError(billing().findCharges(platformUser()));
        await expectClientError(billing().issueCharges(null, DECEMBER));
        await expectClientError(gateway.getGateway(null));
        await expectClientError(
          gateway.setGateway(noCompanyActor, BillingGatewayMode.ASAAS),
        );
        await expectClientError(
          gateway.saveCredentials(
            noCompanyActor,
            '$aact_hmlg_chave_de_teste_sem_empresa_0003',
          ),
        );
        await expectClientError(gateway.testConnection(noCompanyActor));
        await expectClientError(gateway.configureWebhook(noCompanyActor));
        await expectClientError(gateway.removeCredentials(noCompanyActor));
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
