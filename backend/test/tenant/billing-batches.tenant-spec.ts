import { BillingGatewayMode } from '@prisma/client';
import { onlyDigits, protectDocument } from 'src/billing/billing-document.util';
import { TEST_BILLING_KEY } from './support/billing-test-key';
import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * Emissão em massa (lotes): prévia, criação, processamento da fila (o
 * worker é chamado direto, sem Redis) e isolamento entre empresas.
 */
describe('Emissão em massa (lotes)', () => {
  const ctx = useTwoCompanies();
  const batches = () => ctx.services.billingBatches;
  const gateway = () => ctx.services.billingGateway;
  const issuance = () => ctx.services.billingIssuance;
  const asaas = () => ctx.services.asaas;
  const jobs = () => ctx.services.issueJobs;
  const actorOf = (tenant: typeof ctx.a) => ({
    id: tenant.users.admin.id,
    email: tenant.users.admin.email,
    companyId: tenant.companyId,
    ip: null,
  });
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

  const nextMonth = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      .toISOString()
      .slice(0, 7);
  };
  const useAsaas = async (tenant: typeof ctx.a) => {
    await gateway().setGateway(actorOf(tenant), BillingGatewayMode.ASAAS);
    await gateway().saveCredentials(
      actorOf(tenant),
      `$aact_hmlg_chave_de_teste_${tenant.key}_00000000000000`,
    );
    await gateway().configureWebhook(actorOf(tenant));
    asaas().calls.splice(0, asaas().calls.length);
  };
  // Aluno extra de A no grupo de boletos de A, com ou sem CPF no pagador.
  let extraCount = 0;
  const addStudent = async (options: { withDocument: boolean }) => {
    extraCount += 1;
    const student = await ctx.prisma.student.create({
      data: {
        companyId: ctx.a.companyId,
        groupId: ctx.a.group.id,
        billingTemplateId: ctx.a.billingTemplate.id,
        name: `Aluno Lote Alfa ${extraCount}`,
        registration: `LOTE-${extraCount}`,
      },
    });
    await ctx.prisma.billingCustomer.create({
      data: {
        companyId: ctx.a.companyId,
        studentId: student.id,
        name: `Pagador Lote Alfa ${extraCount}`,
        ...(options.withDocument
          ? protectDocument(onlyDigits('52998224725'), TEST_BILLING_KEY)
          : {}),
      },
    });
    return student;
  };
  const processAll = async (finalAttempt = false) => {
    const results: string[] = [];
    for (const chargeId of [...jobs()]) {
      results.push(
        (await batches().processCharge(chargeId, { finalAttempt })).outcome,
      );
    }
    return results;
  };

  beforeEach(() => {
    asaas().reset();
    jobs().splice(0, jobs().length);
  });

  describe('prévia', () => {
    it('mostra a situação de cada aluno e soma só os prontos', async () => {
      await useAsaas(ctx.a);
      const withoutDocument = await addStudent({ withDocument: false });
      await addStudent({ withDocument: true });

      const preview = await batches().preview(ctx.a.companyId, {
        templateId: ctx.a.billingTemplate.id,
        referenceMonth: nextMonth(),
      });

      expect(preview.counts).toMatchObject({
        total: 3,
        READY: 2,
        MISSING_DOCUMENT: 1,
      });
      expect(
        preview.items.find((item) => item.studentId === withoutDocument.id),
      ).toMatchObject({
        state: 'MISSING_DOCUMENT',
        reason: expect.stringContaining('CPF/CNPJ') as unknown as string,
      });
      expect(preview.readyAmountCents).toBe(
        2 * ctx.a.billingTemplate.amountCents,
      );
      expectNoDataFrom(preview, ctx.b);
    });

    it('cobrança já existente no mês e vencimento antes da emissão são apontados', async () => {
      // A fixture já tem a cobrança de setembro/2026 do aluno de A.
      const charged = await batches().preview(ctx.a.companyId, {
        referenceMonth: '2026-09',
      });
      const late = await batches().preview(ctx.a.companyId, {
        referenceMonth: nextMonth(),
        issueDate: `${nextMonth()}-28`,
      });

      expect(charged.items[0].state).toBe('ALREADY_CHARGED');
      expect(late.items[0].state).toBe('DUE_BEFORE_ISSUE');
    });

    it('grupo de boletos de B: 404 sem dado de B', async () => {
      const error = await expectClientError(
        batches().preview(ctx.a.companyId, {
          templateId: ctx.b.billingTemplate.id,
          referenceMonth: nextMonth(),
        }),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });
  });

  describe('gateway próprio', () => {
    it('o lote cria as cobranças e termina na hora, sem fila nem Asaas', async () => {
      const extra = await addStudent({ withDocument: false });

      const batch = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id, extra.id],
      });

      expect(batch).toMatchObject({
        status: 'COMPLETED',
        total: 2,
        succeeded: 2,
        failed: 0,
      });
      expect(batch.items.every((item) => item.status === 'ISSUED')).toBe(true);
      expect(jobs()).toEqual([]);
      expect(asaas().calls).toEqual([]);
    });

    it('data de emissão futura deixa as cobranças agendadas', async () => {
      const batch = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        issueDate: `${nextMonth()}-01`,
        studentIds: [ctx.a.student.id],
      });

      expect(batch.items[0].status).toBe('SCHEDULED');
    });
  });

  describe('Asaas', () => {
    it('cria cobranças pendentes, uma por job; processar a fila completa o lote', async () => {
      await useAsaas(ctx.a);
      const extra = await addStudent({ withDocument: true });

      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id, extra.id],
      });

      expect(created).toMatchObject({
        status: 'PROCESSING',
        total: 2,
        pending: 2,
      });
      expect(jobs()).toHaveLength(2);

      expect(await processAll()).toEqual(['ISSUED', 'ISSUED']);
      const done = await batches().get(ctx.a.companyId, created.id);

      expect(done).toMatchObject({
        status: 'COMPLETED',
        succeeded: 2,
        failed: 0,
      });
      expect(asaas().payments.size).toBe(2);
    });

    it('aluno sem CPF na confirmação fica de fora, com o motivo', async () => {
      await useAsaas(ctx.a);
      const withoutDocument = await addStudent({ withDocument: false });

      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id, withoutDocument.id],
      });

      expect(created.total).toBe(1);
      expect(created.skipped).toBe(1);
      expect(created.skippedDetails).toEqual([
        expect.objectContaining({
          studentId: withoutDocument.id,
          reason: expect.stringContaining('CPF/CNPJ') as unknown as string,
        }),
      ]);
    });

    it('recusa do Asaas em um aluno: PARTIAL_FAILURE com o motivo dele', async () => {
      await useAsaas(ctx.a);
      const extra = await addStudent({ withDocument: true });
      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id, extra.id],
      });

      asaas().failures.failCreatePayment = true;
      await batches().processCharge(jobs()[0], { finalAttempt: false });
      asaas().failures.failCreatePayment = false;
      await batches().processCharge(jobs()[1], { finalAttempt: false });
      const done = await batches().get(ctx.a.companyId, created.id);

      expect(done).toMatchObject({
        status: 'PARTIAL_FAILURE',
        succeeded: 1,
        failed: 1,
      });
      expect(
        done.items.find((item) => item.status === 'FAILED')?.error,
      ).toContain('O Asaas recusou os dados');
    });

    it('Asaas fora do ar: fica pendente e a fila tenta de novo; na última tentativa vira erro', async () => {
      await useAsaas(ctx.a);
      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id],
      });
      asaas().failures.unavailableCreatePayment = true;

      const first = await batches().processCharge(jobs()[0], {
        finalAttempt: false,
      });
      const pending = await batches().get(ctx.a.companyId, created.id);
      const last = await batches().processCharge(jobs()[0], {
        finalAttempt: true,
      });
      const done = await batches().get(ctx.a.companyId, created.id);

      expect(first.outcome).toBe('RETRY');
      expect(pending).toMatchObject({ status: 'PROCESSING', pending: 1 });
      expect(pending.items[0].error).toContain('nova tentativa automática');
      expect(last.outcome).toBe('FAILED');
      expect(done).toMatchObject({ status: 'FAILED', failed: 1 });
    });

    it('timeout depois de criar + nova tentativa: adota a cobrança, sem duplicar', async () => {
      await useAsaas(ctx.a);
      await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id],
      });
      asaas().failures.timeoutAfterCreatePayment = true;

      const first = await batches().processCharge(jobs()[0], {
        finalAttempt: false,
      });
      const second = await batches().processCharge(jobs()[0], {
        finalAttempt: false,
      });

      expect(first.outcome).toBe('RETRY');
      expect(second.outcome).toBe('ISSUED');
      expect(asaas().payments.size).toBe(1);
    });

    it('o mesmo job processado duas vezes: uma cobrança no Asaas e contagem certa', async () => {
      await useAsaas(ctx.a);
      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id],
      });

      await batches().processCharge(jobs()[0], { finalAttempt: false });
      const again = await batches().processCharge(jobs()[0], {
        finalAttempt: false,
      });
      const done = await batches().get(ctx.a.companyId, created.id);

      expect(again.outcome).toBe('DONE');
      expect(asaas().payments.size).toBe(1);
      expect(done).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    });

    it('aluno emitido individualmente antes da confirmação fica de fora do lote', async () => {
      await useAsaas(ctx.a);
      await issuance().issue(actorOf(ctx.a), {
        studentId: ctx.a.student.id,
        templateId: ctx.a.billingTemplate.id,
        referenceMonth: nextMonth(),
      });
      const extra = await addStudent({ withDocument: true });

      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id, extra.id],
      });

      expect(created).toMatchObject({ total: 1, skipped: 1 });
      expect(
        await ctx.prisma.billingCharge.count({
          where: { studentId: ctx.a.student.id, referenceMonth: nextMonth() },
        }),
      ).toBe(1);
    });

    it('reenviar à mão uma cobrança que falhou atualiza o lote', async () => {
      await useAsaas(ctx.a);
      const created = await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id],
      });
      asaas().failures.failCreatePayment = true;
      await batches().processCharge(jobs()[0], { finalAttempt: true });
      asaas().failures.failCreatePayment = false;

      await issuance().retry(actorOf(ctx.a), jobs()[0]);
      const done = await batches().get(ctx.a.companyId, created.id);

      expect(done).toMatchObject({
        status: 'COMPLETED',
        succeeded: 1,
        failed: 0,
      });
    });

    it('o cron reenfileira cobrança de lote parada', async () => {
      await useAsaas(ctx.a);
      await batches().create(actorOf(ctx.a), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.a.student.id],
      });
      const [chargeId] = jobs();
      jobs().splice(0, jobs().length);
      await ctx.prisma.$executeRaw`
        UPDATE "BillingCharge" SET "updatedAt" = now() - interval '10 minutes'
        WHERE id = ${chargeId}
      `;

      const requeued = await batches().requeueStalledBatchCharges();

      expect(requeued).toBe(1);
      expect(jobs()).toEqual([chargeId]);
    });
  });

  describe('isolamento entre empresas', () => {
    it('ids de alunos de B no pedido de A ficam de fora e B não muda', async () => {
      const batch = await bUnchanged(() =>
        batches().create(actorOf(ctx.a), {
          referenceMonth: nextMonth(),
          studentIds: [ctx.a.student.id, ctx.b.student.id],
        }),
      );

      expect(batch).toMatchObject({ total: 1, skipped: 1 });
      expectNoDataFrom(batch, ctx.b);
    });

    it('só alunos de B no pedido de A: 400 e nada criado', async () => {
      const error = await bUnchanged(() =>
        expectClientError(
          batches().create(actorOf(ctx.a), {
            referenceMonth: nextMonth(),
            studentIds: [ctx.b.student.id],
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expect(
        await ctx.prisma.billingBatch.count({
          where: { companyId: ctx.a.companyId },
        }),
      ).toBe(1); // só o lote da fixture
    });

    it('A não lê o lote de B nem o vê na lista (404)', async () => {
      const batchOfB = await batches().create(actorOf(ctx.b), {
        referenceMonth: nextMonth(),
        studentIds: [ctx.b.student.id],
      });

      const error = await expectClientError(
        batches().get(ctx.a.companyId, batchOfB.id),
      );
      const list = await batches().list(ctx.a.companyId);

      expect(error.getStatus()).toBe(404);
      expect(list.data.map((batch) => batch.id)).toEqual([
        ctx.a.billingBatch.id,
      ]);
      expectNoDataFrom(error, ctx.b);
      expectNoDataFrom(list, ctx.b);
    });

    it('sem empresa (PLATFORM_ADMIN): recusado', async () => {
      const noCompany = { ...actorOf(ctx.a), companyId: null };

      await expectClientError(
        batches().preview(null, { referenceMonth: nextMonth() }),
      );
      await expectClientError(
        batches().create(noCompany, {
          referenceMonth: nextMonth(),
          studentIds: [ctx.a.student.id],
        }),
      );
      await expectClientError(batches().list(null));
    });
  });
});
