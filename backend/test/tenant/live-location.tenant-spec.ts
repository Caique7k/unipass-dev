import { expectNoDataFrom } from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

const SECOND_MS = 1000;

/**
 * Qual UniHub a posição ao vivo usa quando o ônibus tem mais de um. Fica na
 * suíte de banco porque depende do PostgreSQL de verdade: num ORDER BY ... DESC
 * ele põe os NULL primeiro, e um Prisma falso devolveria o que o mock mandasse.
 *
 * Os UniHubs extras são criados dentro de cada teste: o useTwoCompanies zera o
 * banco antes de cada teste, então nada sobra para o próximo.
 */
describe('Posição ao vivo — qual UniHub do ônibus aparece', () => {
  const ctx = useTwoCompanies();
  const location = () => ctx.services.location;
  let created = 0;

  type DeviceOptions = {
    /** Telemetria de N segundos atrás; sem isso, nunca mandou posição. */
    telemetrySecondsAgo?: number;
    active?: boolean;
    companyId?: string;
    label?: string;
  };

  // UniHub pareado no ônibus reserva de A (que começa sem nenhum). Cada um é
  // criado 1 minuto depois do anterior, para o desempate por createdAt nunca
  // decidir por acaso.
  const createDevice = async (options: DeviceOptions = {}) => {
    created += 1;
    const label = options.label ?? `alfa-live-${created}`;
    const createdAt = new Date(Date.now() - (60 - created) * 60 * SECOND_MS);
    const telemetry =
      options.telemetrySecondsAgo === undefined
        ? {}
        : {
            lastLat: -23.5 - created / 100,
            lastLng: -46.6 - created / 100,
            lastUpdate: new Date(
              Date.now() - options.telemetrySecondsAgo * SECOND_MS,
            ),
          };

    return ctx.prisma.device.create({
      data: {
        companyId: options.companyId ?? ctx.a.companyId,
        busId: ctx.a.spareBus.id,
        hardwareId: `HW-${label}`,
        code: `UNP-${label}`,
        secret: `secret-${label}`,
        name: label,
        pairedAt: createdAt,
        createdAt,
        active: options.active ?? true,
        ...telemetry,
      },
    });
  };

  const liveOfSpareBus = () =>
    location().getLiveBusLocation(ctx.a.companyId, ctx.a.spareBus.id);

  beforeEach(() => {
    created = 0;
  });

  it('UniHub sem telemetria não esconde o que está mandando posição', async () => {
    const sending = await createDevice({ telemetrySecondsAgo: 5 });
    await createDevice(); // mais novo, nunca mandou posição

    const live = await liveOfSpareBus();

    expect(live.state).toBe('live');
    expect(live.linkedDevice?.id).toBe(sending.id);
    expect(live.telemetry).toEqual({
      latitude: sending.lastLat,
      longitude: sending.lastLng,
      lastUpdate: sending.lastUpdate,
    });
  });

  it('com dois mandando posição, vale a telemetria mais recente', async () => {
    const latest = await createDevice({ telemetrySecondsAgo: 5 });
    await createDevice({ telemetrySecondsAgo: 30 }); // mais novo, posição mais antiga

    const live = await liveOfSpareBus();

    expect(live.state).toBe('live');
    expect(live.linkedDevice?.id).toBe(latest.id);
  });

  it('UniHub inativo não esconde o ativo, mesmo com telemetria mais recente', async () => {
    const active = await createDevice({ telemetrySecondsAgo: 20 });
    await createDevice({ telemetrySecondsAgo: 2, active: false });

    const live = await liveOfSpareBus();

    expect(live.state).toBe('live');
    expect(live.linkedDevice?.id).toBe(active.id);
  });

  it('nenhum mandou posição: sem dispositivo online, com o UniHub mais novo (como antes)', async () => {
    await createDevice();
    const newest = await createDevice();

    const live = await liveOfSpareBus();

    expect(live).toMatchObject({
      state: 'no-online-device',
      telemetry: null,
      linkedDevice: { id: newest.id },
    });
  });

  it('telemetria de mais de 45 s: posição desatualizada (stale), com a última posição', async () => {
    const device = await createDevice({ telemetrySecondsAgo: 10 * 60 });

    const live = await liveOfSpareBus();

    expect(live.state).toBe('stale');
    expect(live.linkedDevice?.id).toBe(device.id);
    expect(live.telemetry).toEqual({
      latitude: device.lastLat,
      longitude: device.lastLng,
      lastUpdate: device.lastUpdate,
    });
  });

  it('só UniHub inativo no ônibus: precisa parear, sem UniHub na resposta (como antes)', async () => {
    await createDevice({ telemetrySecondsAgo: 2, active: false });

    const live = await liveOfSpareBus();

    expect(live).toMatchObject({
      state: 'needs-pairing',
      linkedDevice: null,
      telemetry: null,
    });
  });

  it('UniHub de outra empresa apontando para o ônibus não aparece', async () => {
    const own = await createDevice({ telemetrySecondsAgo: 20 });
    // Dado inconsistente de propósito: aparelho de B no ônibus de A.
    await createDevice({
      telemetrySecondsAgo: 1,
      companyId: ctx.b.companyId,
      label: 'bravo-intruso',
    });

    const live = await liveOfSpareBus();

    expect(live.linkedDevice?.id).toBe(own.id);
    expectNoDataFrom(live, ctx.b);
  });

  it('massa padrão: o ônibus de A mostra o UniHub com telemetria, não o que espera credenciais', async () => {
    const live = await location().getLiveBusLocation(
      ctx.a.companyId,
      ctx.a.bus.id,
    );

    expect(live.state).toBe('live');
    expect(live.linkedDevice?.id).toBe(ctx.a.device.id);
    expect(live.linkedDevice?.id).not.toBe(ctx.a.pendingDevice.id);
  });
});
