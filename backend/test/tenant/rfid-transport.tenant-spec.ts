import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
  expectNoDataFromAnyCompany,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * TAG e embarque (acesso físico ao ônibus): a empresa A nunca vincula, lê ou
 * cancela nada de B, nem registra embarque com UniHub ou TAG de B.
 */
describe('Isolamento entre empresas — TAG e embarque', () => {
  const ctx = useTwoCompanies();
  const rfid = () => ctx.services.rfid;
  const transport = () => ctx.services.transport;
  const adminA = () => ({
    id: ctx.a.users.admin.id,
    companyId: ctx.a.companyId,
  });
  // O que o UniHub da empresa A manda ao ler uma TAG.
  const readOnDeviceA = (rfidTag: string) =>
    transport().handleIotRead({
      code: ctx.a.device.code as string,
      secret: ctx.a.device.secret as string,
      rfidTag,
    });
  const nothingChanges = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(
      ctx.prisma,
      [ctx.a.companyId, ctx.b.companyId],
      action,
    );
  const bUnchanged = <T>(action: () => Promise<T>) =>
    expectCompaniesUnchanged(ctx.prisma, [ctx.b.companyId], action);

  describe('vincular TAG', () => {
    it('a TAG de um aluno de B num aluno de A dá 400 sem dizer de quem é', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          rfid().link(ctx.a.companyId, {
            studentId: ctx.a.spareStudent.id,
            rfidTag: ctx.b.rfidTag,
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('a TAG livre de B (aluno desativado) também não passa para A', async () => {
      await ctx.prisma.student.update({
        where: { id: ctx.b.student.id },
        data: { active: false },
      });
      await ctx.prisma.rfidCard.update({
        where: { id: ctx.b.rfidCard.id },
        data: { active: false },
      });

      const error = await nothingChanges(() =>
        expectClientError(
          rfid().link(ctx.a.companyId, {
            studentId: ctx.a.spareStudent.id,
            rfidTag: ctx.b.rfidTag,
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('vincular TAG num aluno de B dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          rfid().link(ctx.a.companyId, {
            studentId: ctx.b.student.id,
            rfidTag: 'AA00AA77',
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('trocar a TAG de um aluno de A só libera a TAG antiga dele (controle)', async () => {
      await bUnchanged(() =>
        rfid().link(ctx.a.companyId, {
          studentId: ctx.a.student.id,
          rfidTag: 'AA00AA55',
          replaceExisting: true,
        }),
      );

      const cards = await ctx.prisma.rfidCard.findMany({
        where: { studentId: ctx.a.student.id },
        orderBy: { tag: 'asc' },
      });
      expect(cards.map(({ tag, active }) => ({ tag, active }))).toEqual([
        { tag: ctx.a.rfidTag, active: false },
        { tag: 'AA00AA55', active: true },
      ]);
    });
  });

  describe('captura de TAG pelo UniHub', () => {
    it('abrir captura no UniHub de B dá 404 e não cria sessão', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          rfid().startCapture(adminA(), { deviceId: ctx.b.device.id }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('abrir captura no UniHub de A não cancela a captura de B (controle)', async () => {
      const session = await bUnchanged(() =>
        rfid().startCapture(adminA(), { deviceId: ctx.a.device.id }),
      );

      expect(session.status).toBe('PENDING');
      expectNoDataFrom(session, ctx.b);
    });

    it('ler a sessão de captura de B dá 404 sem dado de B', async () => {
      const error = await expectClientError(
        rfid().getCapture(adminA(), ctx.b.captureSession.id),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });

    it('cancelar a sessão de captura de B não cancela nada', async () => {
      const result = await nothingChanges(() =>
        rfid().cancelCapture(adminA(), ctx.b.captureSession.id),
      );

      expect(result).toEqual({ cancelled: false });
    });

    it('a leitura do UniHub de A só preenche a captura de A', async () => {
      const result = await bUnchanged(() => readOnDeviceA('AA00AA66'));

      expect(result).toMatchObject({ status: 'CAPTURED', tag: 'AA00AA66' });
    });

    it('a captura de A que lê a TAG de um aluno de B avisa que já existe, sem dizer de quem', async () => {
      const capture = await bUnchanged(async () => {
        await readOnDeviceA(ctx.b.rfidTag);
        return rfid().getCapture(adminA(), ctx.a.captureSession.id);
      });

      // A TAG em si foi lida pelo leitor de A; o resto da resposta não pode
      // trazer nada do cadastro de B.
      const { tag, ...rest } = capture;
      expect(tag).toBe(ctx.b.rfidTag);
      expect(rest).toMatchObject({
        status: 'CAPTURED',
        alreadyRegistered: true,
        linkedStudentName: null,
      });
      expectNoDataFrom(rest, ctx.b);
    });

    it('a captura de A que lê a TAG de um aluno de A mostra o nome dele (controle)', async () => {
      await readOnDeviceA(ctx.a.rfidTag);
      const capture = await rfid().getCapture(
        adminA(),
        ctx.a.captureSession.id,
      );

      expect(capture).toMatchObject({
        alreadyRegistered: true,
        linkedStudentName: ctx.a.student.name,
      });
    });
  });

  describe('embarque pelo painel', () => {
    it.each([
      ['embarque', 'registerBoarding'],
      ['desembarque', 'registerDeboarding'],
    ] as const)(
      '%s com o UniHub de B dá 403 e nenhum evento é criado',
      async (_label, method) => {
        const error = await nothingChanges(() =>
          expectClientError(
            transport()[method](ctx.a.companyId, {
              deviceIdentifier: ctx.b.device.code as string,
              rfidTag: ctx.a.rfidTag,
            }),
          ),
        );

        expect(error.getStatus()).toBe(403);
        expectNoDataFrom(error, ctx.b);
      },
    );

    it('embarque com a TAG de um aluno de B é negado, e o registro fica em A sem nada de B', async () => {
      const error = await bUnchanged(() =>
        expectClientError(
          transport().registerBoarding(ctx.a.companyId, {
            deviceIdentifier: ctx.a.device.code as string,
            rfidTag: ctx.b.rfidTag,
          }),
        ),
      );

      expect(error.getStatus()).toBe(403);
      expectNoDataFrom(error, ctx.b);

      const denied = await ctx.prisma.transportEvent.findMany({
        where: { companyId: ctx.a.companyId, type: 'DENIED' },
      });
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        deviceId: ctx.a.device.id,
        studentId: null,
        rfidCardId: null,
      });
      expectNoDataFrom(denied, ctx.b);
    });

    it('desembarque de um aluno de A no UniHub de A funciona (controle)', async () => {
      const result = await bUnchanged(() =>
        transport().registerDeboarding(ctx.a.companyId, {
          deviceIdentifier: ctx.a.device.code as string,
          rfidTag: ctx.a.rfidTag,
        }),
      );

      expect(result).toMatchObject({
        status: 'AUTHORIZED',
        action: 'DEBOARDING',
        student: { id: ctx.a.student.id },
      });
    });
  });

  describe('leitura do UniHub (IoT)', () => {
    // Sem captura aberta, a leitura vira embarque/desembarque.
    const cancelCaptureOfA = () =>
      rfid().cancelCapture(adminA(), ctx.a.captureSession.id);

    it('o UniHub de A lendo a TAG de um aluno de B é negado como TAG desconhecida', async () => {
      await expect(cancelCaptureOfA()).resolves.toEqual({ cancelled: true });

      const result = await bUnchanged(() => readOnDeviceA(ctx.b.rfidTag));

      expect(result).toEqual({
        mode: 'TRANSPORT',
        status: 'DENIED',
        reason: 'UNKNOWN_TAG',
      });
      const denied = await ctx.prisma.transportEvent.findMany({
        where: { companyId: ctx.a.companyId, type: 'DENIED' },
      });
      expect(denied).toHaveLength(1);
      expectNoDataFrom(denied, ctx.b);
    });

    it('o UniHub de A lendo a TAG de um aluno de A reconhece o aluno (controle)', async () => {
      await cancelCaptureOfA();

      const result = await bUnchanged(() => readOnDeviceA(ctx.a.rfidTag));

      expect(result).toMatchObject({ student: { id: ctx.a.student.id } });
      expectNoDataFrom(result, ctx.b);
    });
  });

  describe('retorno do dia', () => {
    it('mostra só os alunos de A que embarcaram hoje', async () => {
      const overview = await transport().getDailyBoardingOverview(
        ctx.a.companyId,
      );

      expect(
        [...overview.notBoardedStudents, ...overview.boardedStudents].map(
          (student) => student.id,
        ),
      ).toEqual([ctx.a.student.id]);
      expectNoDataFrom(overview, ctx.b);
    });
  });

  describe('sem empresa (companyId nulo, como o PLATFORM_ADMIN)', () => {
    const noCompany = null as unknown as string;
    const platformUser = () => ({ id: ctx.platformAdmin.id, companyId: null });

    it('vincular, capturar, embarcar e o retorno do dia não devolvem nem mexem em nada', async () => {
      await nothingChanges(async () => {
        await expectNoDataFromAnyCompany(
          () =>
            rfid().link(noCompany, {
              studentId: ctx.b.student.id,
              rfidTag: 'AA00AA88',
            }),
          [ctx.a, ctx.b],
        );
        await expectClientError(
          rfid().startCapture(platformUser(), { deviceId: ctx.b.device.id }),
        );
        await expectClientError(
          rfid().getCapture(platformUser(), ctx.b.captureSession.id),
        );
        await expectClientError(
          rfid().cancelCapture(platformUser(), ctx.b.captureSession.id),
        );
        await expectClientError(
          transport().registerBoarding(noCompany, {
            deviceIdentifier: ctx.b.device.code as string,
            rfidTag: ctx.b.rfidTag,
          }),
        );
        await expectNoDataFromAnyCompany(
          () => transport().getDailyBoardingOverview(noCompany),
          [ctx.a, ctx.b],
        );
      });
    });
  });
});
