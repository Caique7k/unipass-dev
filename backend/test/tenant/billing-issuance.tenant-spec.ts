import { BillingGatewayMode, UserRole } from '@prisma/client';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * Emissão de UMA cobrança (gateway próprio e Asaas), reenvio e cancelamento,
 * com banco de verdade e Asaas falso (support/asaas-fake.ts).
 */
describe('Emissão individual de boletos', () => {
  const ctx = useTwoCompanies();
  const issuance = () => ctx.services.billingIssuance;
  const gateway = () => ctx.services.billingGateway;
  const asaas = () => ctx.services.asaas;
  const actorOf = (tenant: typeof ctx.a) => ({
    id: tenant.users.admin.id,
    email: tenant.users.admin.email,
    companyId: tenant.companyId,
    ip: null,
  });
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

  // Próximo mês (a fixture só tem cobrança antiga): vencimento sempre futuro.
  const nextMonth = () => {
    const now = new Date();
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return date.toISOString().slice(0, 7);
  };
  const dtoFor = (tenant: typeof ctx.a, overrides = {}) => ({
    studentId: tenant.student.id,
    templateId: tenant.billingTemplate.id,
    referenceMonth: nextMonth(),
    ...overrides,
  });
  const useAsaas = async (tenant: typeof ctx.a) => {
    await gateway().setGateway(actorOf(tenant), BillingGatewayMode.ASAAS);
    await gateway().saveCredentials(
      actorOf(tenant),
      `$aact_hmlg_chave_de_teste_${tenant.key}_00000000000000`,
    );
    await gateway().configureWebhook(actorOf(tenant));
    asaas().calls.splice(0, asaas().calls.length);
  };

  beforeEach(() => asaas().reset());

  describe('gateway próprio', () => {
    it('emite só no UniPass, sem nenhuma chamada ao Asaas', async () => {
      const result = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      expect(result.outcome).toBe('ISSUED');
      expect(result.charge).toMatchObject({
        status: 'ISSUED',
        gateway: 'EXTERNAL',
        referenceMonth: nextMonth(),
        amountCents: ctx.a.billingTemplate.amountCents,
      });
      expect(asaas().calls).toEqual([]);
    });

    it('valor e vencimento editados valem no lugar dos do grupo', async () => {
      const dueDate = `${nextMonth()}-20`;
      const result = await issuance().issue(
        actorOf(ctx.a),
        dtoFor(ctx.a, { amountCents: 12345, dueDate, description: 'Ajuste' }),
      );

      expect(result.charge).toMatchObject({
        amountCents: 12345,
        description: 'Ajuste',
      });
      expect(new Date(result.charge.dueDate).toISOString().slice(0, 10)).toBe(
        dueDate,
      );
    });
  });

  describe('Asaas', () => {
    it('emite: cliente + cobrança no Asaas, linha digitável e Pix gravados', async () => {
      await useAsaas(ctx.a);

      const result = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      expect(result.outcome).toBe('ISSUED');
      expect(result.charge).toMatchObject({
        status: 'ISSUED',
        gateway: 'ASAAS',
      });
      expect(result.charge.identificationField).toContain('23790');
      expect(result.charge.barCode).toBeTruthy();
      expect(result.charge.pixPayload).toContain('PIX');
      expect(result.charge.bankSlipUrl).toContain('sandbox.asaas.com');
      expect(asaas().calls).toEqual(
        expect.arrayContaining(['createCustomer', 'createPayment']),
      );
      // O CPF foi enviado ao Asaas, mas nunca volta inteiro na resposta.
      const [customer] = [...asaas().customers.values()];
      expect(customer.cpfCnpj).toBe('11111111111');
      expect(JSON.stringify(result)).not.toContain('11111111111');
    });

    it('segunda emissão do mesmo pagador reaproveita o cliente no Asaas', async () => {
      await useAsaas(ctx.a);
      const first = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));
      await issuance().cancel(actorOf(ctx.a), first.charge.id);
      asaas().calls.splice(0, asaas().calls.length);

      await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      expect(asaas().calls).not.toContain('createCustomer');
      expect(asaas().customers.size).toBe(1);
    });

    it('pagador sem CPF/CNPJ: 400 com o que corrigir e nenhuma chamada ao Asaas', async () => {
      await useAsaas(ctx.a);

      const error = await expectClientError(
        issuance().issue(
          actorOf(ctx.a),
          dtoFor(ctx.a, { studentId: ctx.a.spareStudent.id }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('não tem CPF/CNPJ');
      expect(asaas().calls).toEqual([]);
      await expect(
        ctx.prisma.billingCharge.count({
          where: { studentId: ctx.a.spareStudent.id },
        }),
      ).resolves.toBe(0);
    });

    it('Asaas sem webhook configurado: 400 e nada criado', async () => {
      await gateway().setGateway(actorOf(ctx.a), BillingGatewayMode.ASAAS);
      await gateway().saveCredentials(
        actorOf(ctx.a),
        '$aact_hmlg_chave_de_teste_sem_webhook_00000000000',
      );
      asaas().calls.splice(0, asaas().calls.length);

      const error = await expectClientError(
        issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)),
      );

      expect(error.message).toContain('webhook');
      expect(asaas().calls).toEqual([]);
    });

    it('Asaas recusa: cobrança fica FAILED com a mensagem traduzida', async () => {
      await useAsaas(ctx.a);
      asaas().failures.failCreatePayment = true;

      const result = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      expect(result.outcome).toBe('FAILED');
      expect(result.message).toContain('Cliente inválido para esta cobrança.');
      expect(result.charge.status).toBe('FAILED');
      expect(result.charge.gatewayError).toContain('O Asaas recusou os dados');
    });

    it('timeout depois de criar + "tentar de novo": adota a cobrança, sem criar outra', async () => {
      await useAsaas(ctx.a);
      asaas().failures.timeoutAfterCreatePayment = true;

      const first = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));
      expect(first.outcome).toBe('FAILED');
      expect(asaas().payments.size).toBe(1);

      const retried = await issuance().retry(actorOf(ctx.a), first.charge.id);

      expect(retried.outcome).toBe('ISSUED');
      expect(asaas().payments.size).toBe(1);
      expect(
        asaas().calls.filter((call) => call === 'createPayment'),
      ).toHaveLength(1);
      expect(retried.charge.gatewayChargeId).toBe(
        [...asaas().payments.keys()][0],
      );
    });

    it('Pix indisponível não derruba a emissão', async () => {
      await useAsaas(ctx.a);
      asaas().failures.failPix = true;

      const result = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      expect(result.outcome).toBe('ISSUED');
      expect(result.charge.pixPayload).toBeNull();
      expect(result.charge.identificationField).toBeTruthy();
    });

    it('cancelar remove no Asaas e marca CANCELLED; cancelar de novo dá 400', async () => {
      await useAsaas(ctx.a);
      const { charge } = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      const cancelled = await issuance().cancel(actorOf(ctx.a), charge.id);

      expect(cancelled.charge).toMatchObject({ status: 'CANCELLED' });
      expect(
        asaas().payments.get(charge.gatewayChargeId as string)?.deleted,
      ).toBe(true);
      const error = await expectClientError(
        issuance().cancel(actorOf(ctx.a), charge.id),
      );
      expect(error.getStatus()).toBe(400);
    });
  });

  describe('duplicidade', () => {
    it('emitir de novo para o mesmo aluno, grupo e mês: 400 com aviso, nada novo', async () => {
      await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));

      const preview = await issuance().preview(ctx.a.companyId, dtoFor(ctx.a));
      const error = await expectClientError(
        issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)),
      );

      expect(preview.canIssue).toBe(false);
      expect(preview.existingCharge).not.toBeNull();
      expect(error.message).toContain('Já existe uma cobrança');
    });

    it('dois cliques ao mesmo tempo: uma cobrança só', async () => {
      const results = await Promise.allSettled([
        issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)),
        issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(
        ctx.prisma.billingCharge.count({
          where: { studentId: ctx.a.student.id, referenceMonth: nextMonth() },
        }),
      ).resolves.toBe(1);
    });

    it('depois de cancelar, pode emitir de novo para o mesmo mês', async () => {
      const first = await issuance().issue(actorOf(ctx.a), dtoFor(ctx.a));
      await issuance().cancel(actorOf(ctx.a), first.charge.id);

      await expect(
        issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)),
      ).resolves.toMatchObject({ outcome: 'ISSUED' });
    });
  });

  describe('isolamento entre empresas', () => {
    it('A não emite nem pré-visualiza com aluno ou grupo de B (404, B intacta)', async () => {
      for (const dto of [
        dtoFor(ctx.a, { studentId: ctx.b.student.id }),
        dtoFor(ctx.a, { templateId: ctx.b.billingTemplate.id }),
      ]) {
        const issueError = await bUnchanged(() =>
          expectClientError(issuance().issue(actorOf(ctx.a), dto)),
        );
        const previewError = await expectClientError(
          issuance().preview(ctx.a.companyId, dto),
        );

        expect(issueError.getStatus()).toBe(404);
        expect(previewError.getStatus()).toBe(404);
        expectNoDataFrom(issueError, ctx.b);
        expectNoDataFrom(previewError, ctx.b);
      }
    });

    it('A não abre, reenvia nem cancela cobrança de B (404, B intacta)', async () => {
      const reader = {
        companyId: ctx.a.companyId,
        userId: ctx.a.users.admin.id,
        role: UserRole.ADMIN,
      };

      for (const action of [
        () => issuance().getCharge(reader, ctx.b.charge.id),
        () => issuance().retry(actorOf(ctx.a), ctx.b.charge.id),
        () => issuance().cancel(actorOf(ctx.a), ctx.b.charge.id),
      ]) {
        const error = await bUnchanged(() => expectClientError(action()));
        expect(error.getStatus()).toBe(404);
        expectNoDataFrom(error, ctx.b);
      }
    });

    it('o responsável vê a própria cobrança e não a de outro aluno', async () => {
      const own = await issuance().getCharge(
        {
          companyId: ctx.a.companyId,
          userId: ctx.a.users.parent.id,
          role: UserRole.USER,
        },
        ctx.a.charge.id,
      );
      const { charge: otherCharge } = await issuance().issue(
        actorOf(ctx.a),
        dtoFor(ctx.a, { studentId: ctx.a.spareStudent.id }),
      );
      const error = await expectClientError(
        issuance().getCharge(
          {
            companyId: ctx.a.companyId,
            userId: ctx.a.users.parent.id,
            role: UserRole.USER,
          },
          otherCharge.id,
        ),
      );

      expect(own.id).toBe(ctx.a.charge.id);
      // Para quem não é ADMIN, nada de detalhes do gateway.
      expect(own).not.toHaveProperty('gatewayError');
      expect(error.getStatus()).toBe(404);
    });

    it('a emissão de A pelo Asaas usa só a chave de A', async () => {
      await useAsaas(ctx.b);
      await useAsaas(ctx.a);
      asaas().keysUsed.splice(0, asaas().keysUsed.length);

      await bUnchanged(() => issuance().issue(actorOf(ctx.a), dtoFor(ctx.a)));

      expect(asaas().keysUsed.every((key) => key.includes('_alfa_'))).toBe(
        true,
      );
    });
  });

  describe('CPF/CNPJ do pagador', () => {
    it('o cadastro de aluno nunca devolve o documento completo', async () => {
      const student = await ctx.services.students.findOne(
        ctx.a.companyId,
        ctx.a.student.id,
      );

      expect(student.billingCustomer).toMatchObject({
        documentMasked: '***.***.*11-11',
        hasDocument: true,
      });
      expect(JSON.stringify(student)).not.toContain('11111111111');
      expect(JSON.stringify(student)).not.toContain('111.111.111-11');
    });

    it('editar o aluno sem mexer no documento mantém o CPF; documento novo é validado e cifrado', async () => {
      const before = await ctx.prisma.billingCustomer.findUniqueOrThrow({
        where: { id: ctx.a.billingCustomer.id },
      });

      await ctx.services.students.update(ctx.a.companyId, ctx.a.student.id, {
        billingCustomer: { name: 'Novo Responsável', email: 'novo@alfa.test' },
      });
      const kept = await ctx.prisma.billingCustomer.findUniqueOrThrow({
        where: { id: ctx.a.billingCustomer.id },
      });

      const invalid = await expectClientError(
        ctx.services.students.update(ctx.a.companyId, ctx.a.student.id, {
          billingCustomer: { name: 'X', document: '123.456.789-00' },
        }),
      );

      await ctx.services.students.update(ctx.a.companyId, ctx.a.student.id, {
        billingCustomer: {
          name: 'Novo Responsável',
          document: '529.982.247-25',
        },
      });
      const changed = await ctx.prisma.billingCustomer.findUniqueOrThrow({
        where: { id: ctx.a.billingCustomer.id },
      });

      expect(kept.documentHash).toBe(before.documentHash);
      expect(kept.asaasSyncedAt).toBeNull();
      expect(invalid.message).toContain('CPF inválido');
      expect(changed.documentMasked).toBe('***.***.*47-25');
      expect(changed.documentEncrypted).not.toContain('52998224725');
      expect(changed.document).toBeNull();
    });
  });
});
