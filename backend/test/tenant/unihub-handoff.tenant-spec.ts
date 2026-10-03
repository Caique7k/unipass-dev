import { DashboardReportType } from 'src/dashboard/dto/get-dashboard-report.dto';
import {
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';
import { TenantFixture } from './support/two-companies.fixture';

type ReportTable = {
  table: { rows: Array<{ id: string; values: Record<string, string> }> };
};

// [nome da tela, como carregá-la, id que prova que ela mostra a própria empresa]
type Screen = [string, () => Promise<unknown>, () => string];

/**
 * Um UniHub sai de uma empresa (Remover) e é pareado por outra num ônibus
 * dela. O histórico de embarques da empresa original continua apontando para
 * o aparelho: as telas dela mostram esses embarques como de UniHub removido,
 * nunca com ônibus, UniHub ou dado da outra empresa.
 */
describe('Isolamento entre empresas — UniHub que muda de empresa', () => {
  const ctx = useTwoCompanies();
  const adminOf = (tenant: TenantFixture) => ({
    id: tenant.users.admin.id,
    companyId: tenant.companyId,
  });
  const reportOf = (
    tenant: TenantFixture,
    reportType: DashboardReportType,
    busId?: string,
  ) =>
    ctx.services.dashboard.getReport(tenant.companyId, { reportType, busId });
  const rowValues = ({ table }: ReportTable, id: string) =>
    table.rows.find((row) => row.id === id)?.values;

  // As telas que mostram o ônibus/UniHub de cada embarque.
  const screensOf = (tenant: () => TenantFixture): Screen[] => [
    [
      'Retorno do dia',
      () => ctx.services.transport.getDailyBoardingOverview(tenant().companyId),
      () => tenant().student.id,
    ],
    [
      'eventos recentes do painel',
      () => ctx.services.dashboard.getMetrics(tenant().companyId, 'ADMIN'),
      () => tenant().boarding.id,
    ],
    [
      'relatório de movimentação',
      () => reportOf(tenant(), 'boarding'),
      () => tenant().boarding.id,
    ],
    [
      'relatório de frequência',
      () => reportOf(tenant(), 'students'),
      () => tenant().student.id,
    ],
    [
      'relatório de frota',
      () => reportOf(tenant(), 'fleet'),
      () => tenant().bus.id,
    ],
  ];

  /** "Remover" o UniHub: ele volta ao estado de fábrica. */
  const removeDevice = (owner: TenantFixture, deviceId: string) =>
    ctx.services.devices.deleteMany(adminOf(owner), { ids: [deviceId] });

  /** O aparelho pede um código novo e a empresa o pareia num ônibus dela. */
  async function pairDevice(
    newOwner: TenantFixture,
    hardwareId: string,
    busId: string,
  ) {
    const pairing = await ctx.services.devices.startPairing({ hardwareId });

    if (!('pairingCode' in pairing) || !pairing.pairingCode) {
      throw new Error('O aparelho removido não recebeu um código novo.');
    }

    return ctx.services.devices.linkDevice(adminOf(newOwner), {
      pairingCode: pairing.pairingCode,
      busId,
    });
  }

  async function moveDeviceFromAToB() {
    await removeDevice(ctx.a, ctx.a.device.id);
    return pairDevice(ctx.b, ctx.a.device.hardwareId, ctx.b.bus.id);
  }

  async function moveDeviceFromBToA() {
    await removeDevice(ctx.b, ctx.b.device.id);
    return pairDevice(ctx.a, ctx.b.device.hardwareId, ctx.a.spareBus.id);
  }

  describe('antes da troca (controle)', () => {
    it.each(screensOf(() => ctx.a))(
      '%s de A mostra os dados de A e nada de B',
      async (_label, load, ownId) => {
        const result = await load();

        expect(JSON.stringify(result)).toContain(ownId());
        expectNoDataFrom(result, ctx.b);
      },
    );
  });

  describe('o ônibus de A continua aparecendo quando o aparelho nunca saiu de A', () => {
    it('Retorno do dia', async () => {
      const overview = await ctx.services.transport.getDailyBoardingOverview(
        ctx.a.companyId,
      );

      expect(
        overview.notBoardedStudents.find(
          (student) => student.id === ctx.a.student.id,
        ),
      ).toMatchObject({
        firstBusId: ctx.a.bus.id,
        firstBusPlate: ctx.a.bus.plate,
        firstDeviceName: ctx.a.device.name,
        firstDeviceCode: ctx.a.device.code,
      });
    });

    it('eventos recentes do painel', async () => {
      const metrics = await ctx.services.dashboard.getMetrics(
        ctx.a.companyId,
        'ADMIN',
      );

      expect(
        metrics.recentEvents.find(
          (event) => event.eventId === ctx.a.boarding.id,
        ),
      ).toMatchObject({
        busPlate: ctx.a.bus.plate,
        deviceLabel: ctx.a.device.name,
      });
    });

    it('relatório de movimentação', async () => {
      const { report } = await reportOf(ctx.a, 'boarding');

      expect(rowValues(report, ctx.a.boarding.id)).toMatchObject({
        bus: ctx.a.bus.plate,
        device: ctx.a.device.name,
      });
    });

    it('relatório de frequência', async () => {
      const { report } = await reportOf(ctx.a, 'students');

      expect(rowValues(report, ctx.a.student.id)).toMatchObject({
        lastBus: ctx.a.bus.plate,
      });
    });

    it('relatório de frota', async () => {
      const { report } = await reportOf(ctx.a, 'fleet');

      expect(rowValues(report, ctx.a.bus.id)).toMatchObject({
        bus: ctx.a.bus.plate,
        boardings: '1',
      });
    });

    it('filtro pelo ônibus de A nos relatórios', async () => {
      const { report } = await reportOf(ctx.a, 'boarding', ctx.a.bus.id);

      expect(report.table.rows.map((row) => row.id)).toEqual([
        ctx.a.boarding.id,
      ]);
    });
  });

  it('a troca acontece pelos fluxos reais: o aparelho vai para B e o embarque antigo continua de A', async () => {
    const paired = await moveDeviceFromAToB();

    expect(paired).toMatchObject({
      id: ctx.a.device.id,
      companyId: ctx.b.companyId,
      busId: ctx.b.bus.id,
    });
    expect(paired.code).not.toBe(ctx.a.device.code);
    await expect(
      ctx.prisma.transportEvent.findUniqueOrThrow({
        where: { id: ctx.a.boarding.id },
      }),
    ).resolves.toMatchObject({
      companyId: ctx.a.companyId,
      deviceId: ctx.a.device.id,
    });
  });

  describe('depois que B pareia o aparelho que era de A', () => {
    it.each(screensOf(() => ctx.a))(
      '%s de A não mostra nada de B',
      async (_label, load, ownId) => {
        const paired = await moveDeviceFromAToB();
        // O código novo do aparelho agora é credencial de B.
        const b = {
          ...ctx.b,
          fingerprints: [...ctx.b.fingerprints, paired.code as string],
        };

        // A troca muda B de propósito (B ganhou o aparelho); abrir a tela
        // de A não pode mudar nada em nenhuma das duas.
        const result = await expectCompaniesUnchanged(
          ctx.prisma,
          [ctx.a.companyId, ctx.b.companyId],
          load,
        );

        expect(JSON.stringify(result)).toContain(ownId());
        expectNoDataFrom(result, b);
      },
    );

    // O histórico de A fica exatamente como logo depois de "Remover".
    const historyOfA: Screen[] = [
      [
        'Retorno do dia',
        async () => {
          const { notBoardedStudents, boardedStudents, busOptions } =
            await ctx.services.transport.getDailyBoardingOverview(
              ctx.a.companyId,
            );

          return { notBoardedStudents, boardedStudents, busOptions };
        },
        () => ctx.a.student.id,
      ],
      [
        'eventos recentes do painel',
        async () =>
          (await ctx.services.dashboard.getMetrics(ctx.a.companyId, 'ADMIN'))
            .recentEvents,
        () => ctx.a.boarding.id,
      ],
      [
        'relatório de movimentação',
        async () => (await reportOf(ctx.a, 'boarding')).report.table,
        () => ctx.a.boarding.id,
      ],
      [
        'relatório de frequência',
        async () => (await reportOf(ctx.a, 'students')).report.table,
        () => ctx.a.student.id,
      ],
      [
        'relatório de frota',
        async () => (await reportOf(ctx.a, 'fleet')).report.table,
        () => ctx.a.bus.id,
      ],
    ];

    it.each(historyOfA)(
      '%s de A fica igual ao de um UniHub removido',
      async (_label, history, ownId) => {
        await removeDevice(ctx.a, ctx.a.device.id);
        const asRemoved = await history();
        expect(JSON.stringify(asRemoved)).toContain(ownId());

        await pairDevice(ctx.b, ctx.a.device.hardwareId, ctx.b.bus.id);

        await expect(history()).resolves.toEqual(asRemoved);
      },
    );
  });

  describe('quando o aparelho vai de B para A', () => {
    it.each(screensOf(() => ctx.b))(
      '%s de B não mostra nada de A',
      async (_label, load, ownId) => {
        const paired = await moveDeviceFromBToA();
        // O código novo do aparelho agora é credencial de A.
        const a = {
          ...ctx.a,
          fingerprints: [...ctx.a.fingerprints, paired.code as string],
        };

        const result = await expectCompaniesUnchanged(
          ctx.prisma,
          [ctx.a.companyId, ctx.b.companyId],
          load,
        );

        expect(JSON.stringify(result)).toContain(ownId());
        expectNoDataFrom(result, a);
      },
    );

    it('a atividade de B no aparelho não faz o ônibus de A entrar no relatório de frota filtrado por rota', async () => {
      // O aparelho de B foi para o ônibus avulso de A, que não tem horário
      // nessa rota nem evento de A.
      await moveDeviceFromBToA();

      const { report } = await ctx.services.dashboard.getReport(
        ctx.a.companyId,
        { reportType: 'fleet', routeId: ctx.a.route.id },
      );

      expect(report.table.rows.map((row) => row.id)).toEqual([ctx.a.bus.id]);
    });
  });
});
