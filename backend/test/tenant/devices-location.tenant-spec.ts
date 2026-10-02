import {
  expectClientError,
  expectCompaniesUnchanged,
  expectNoDataFrom,
  expectNoDataFromAnyCompany,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';

/**
 * UniHub e localização (onde está o ônibus com as crianças): a empresa A
 * nunca lista, renomeia, troca de ônibus, remove ou pareia um UniHub de B,
 * nem vê a posição de um ônibus de B.
 */
describe('Isolamento entre empresas — UniHub e localização', () => {
  const ctx = useTwoCompanies();
  const devices = () => ctx.services.devices;
  const location = () => ctx.services.location;
  const adminA = () => ({
    id: ctx.a.users.admin.id,
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
  const orphanDevice = () =>
    ctx.prisma.device.findUniqueOrThrow({
      where: { id: ctx.orphanDevice.id },
    });

  describe('leitura', () => {
    it('a lista de A traz os UniHubs de A e nenhum de B nem o órfão', async () => {
      const result = await devices().findAll(adminA(), { page: 1, limit: 100 });

      expect(result.data.map((device) => device.id).sort()).toEqual(
        [ctx.a.device.id, ctx.a.pendingDevice.id].sort(),
      );
      expectNoDataFrom(result, ctx.b);
      expect(JSON.stringify(result)).not.toContain(ctx.orphanDevice.id);
    });

    it('buscar pelo código, hardwareId ou nome de um UniHub de B não acha nada', async () => {
      const search = (term: string) =>
        devices().findAll(adminA(), { page: 1, limit: 100, search: term });

      for (const term of [
        ctx.b.device.code as string,
        ctx.b.device.hardwareId,
        ctx.b.bus.plate,
      ]) {
        await expect(search(term)).resolves.toMatchObject({ data: [] });
      }
      const own = await search(ctx.a.device.code as string);
      expect(own.data.map((device) => device.id)).toEqual([ctx.a.device.id]);
    });

    it('a posição ao vivo de um ônibus de A mostra um UniHub de A (controle)', async () => {
      const live = await location().getLiveBusLocation(
        ctx.a.companyId,
        ctx.a.bus.id,
      );

      expect(live.bus.id).toBe(ctx.a.bus.id);
      expect([ctx.a.device.id, ctx.a.pendingDevice.id]).toContain(
        live.linkedDevice?.id,
      );
      expectNoDataFrom(live, ctx.b);
    });

    it('a posição ao vivo de um ônibus de B dá 404 sem dado de B', async () => {
      const error = await expectClientError(
        location().getLiveBusLocation(ctx.a.companyId, ctx.b.bus.id),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });
  });

  describe('escrita em UniHub de B', () => {
    it('renomear dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          devices().update(adminA(), ctx.b.device.id, { name: 'Invadido' }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('trocar o ônibus dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          devices().linkBus(adminA(), ctx.b.device.id, {
            busId: ctx.a.bus.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('remover dá 404; code, secret e a captura de B ficam intactos', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          devices().deleteMany(adminA(), { ids: [ctx.b.device.id] }),
        ),
      );

      expect(error.getStatus()).toBe(404);
    });

    it('lote misto [A, B]: só o UniHub de A é liberado', async () => {
      const result = await bUnchanged(() =>
        devices().deleteMany(adminA(), {
          ids: [ctx.a.pendingDevice.id, ctx.b.device.id],
        }),
      );

      expect(result.count).toBe(1);
      await expect(
        ctx.prisma.device.findUniqueOrThrow({
          where: { id: ctx.a.pendingDevice.id },
        }),
      ).resolves.toMatchObject({ companyId: null, busId: null, code: null });
    });
  });

  describe('UniHub de A apontando para dados de B', () => {
    it('trocar o UniHub de A para um ônibus de B dá 404 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          devices().linkBus(adminA(), ctx.a.device.id, {
            busId: ctx.b.bus.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
      expectNoDataFrom(error, ctx.b);
    });

    it('parear com o código de um UniHub já vinculado a B dá 400 e nada muda', async () => {
      const error = await nothingChanges(() =>
        expectClientError(
          devices().linkDevice(adminA(), {
            pairingCode: ctx.b.pairingCode,
            busId: ctx.a.bus.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(400);
      expectNoDataFrom(error, ctx.b);
    });

    it('parear um UniHub sem dono num ônibus de B dá 404 e ele continua sem dono', async () => {
      const before = await orphanDevice();

      const error = await nothingChanges(() =>
        expectClientError(
          devices().linkDevice(adminA(), {
            pairingCode: before.pairingCode as string,
            busId: ctx.b.bus.id,
          }),
        ),
      );

      expect(error.getStatus()).toBe(404);
      await expect(orphanDevice()).resolves.toEqual(before);
    });

    it('parear um UniHub sem dono num ônibus de A funciona (controle)', async () => {
      const paired = await bUnchanged(() =>
        devices().linkDevice(adminA(), {
          pairingCode: ctx.orphanDevice.pairingCode as string,
          busId: ctx.a.bus.id,
        }),
      );

      expect(paired).toMatchObject({
        id: ctx.orphanDevice.id,
        companyId: ctx.a.companyId,
        busId: ctx.a.bus.id,
      });
      expectNoDataFrom(paired, ctx.b);
    });

    it('a telemetria do UniHub de A só atualiza o UniHub de A', async () => {
      await bUnchanged(() =>
        location().updateDeviceTelemetry({
          code: ctx.a.device.code as string,
          secret: ctx.a.device.secret as string,
          latitude: -22.9,
          longitude: -43.2,
        }),
      );

      await expect(
        ctx.prisma.device.findUniqueOrThrow({ where: { id: ctx.a.device.id } }),
      ).resolves.toMatchObject({ lastLat: -22.9, lastLng: -43.2 });
    });
  });

  describe('sem empresa (companyId nulo, como o PLATFORM_ADMIN)', () => {
    const platformUser = () => ({ id: ctx.platformAdmin.id, companyId: null });

    it('listar e ver posição não devolvem dado de empresa nenhuma', async () => {
      // A lista sem empresa pode trazer UniHubs ainda sem dono; nunca de A ou B.
      await expectNoDataFromAnyCompany(
        () => devices().findAll(platformUser(), { page: 1, limit: 100 }),
        [ctx.a, ctx.b],
      );
      await expectNoDataFromAnyCompany(
        () =>
          location().getLiveBusLocation(
            null as unknown as string,
            ctx.a.bus.id,
          ),
        [ctx.a, ctx.b],
      );
    });

    it('renomear, trocar ônibus, remover e parear não mexem em empresa nenhuma', async () => {
      await nothingChanges(async () => {
        await expectClientError(
          devices().update(platformUser(), ctx.b.device.id, {
            name: 'Invadido',
          }),
        );
        // Aqui o próprio Prisma recusa ("companyId must not be null").
        await expectNoDataFromAnyCompany(
          () =>
            devices().linkBus(platformUser(), ctx.b.device.id, {
              busId: ctx.b.bus.id,
            }),
          [ctx.a, ctx.b],
        );
        await expectClientError(
          devices().deleteMany(platformUser(), {
            ids: [ctx.a.device.id, ctx.b.device.id],
          }),
        );
        await expectNoDataFromAnyCompany(
          () =>
            devices().linkDevice(platformUser(), {
              pairingCode: ctx.orphanDevice.pairingCode as string,
              busId: ctx.a.bus.id,
            }),
          [ctx.a, ctx.b],
        );
      });
    });
  });
});
