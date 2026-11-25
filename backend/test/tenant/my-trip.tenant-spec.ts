import { Prisma, UserRole } from '@prisma/client';
import {
  getAppTimeZone,
  getZonedDayStart,
} from 'src/notifications/notification-time.util';
import {
  expectCompaniesUnchanged,
  expectNoDataFrom,
} from './support/expectations';
import { useTwoCompanies } from './support/tenant-context';
import { TenantFixture } from './support/two-companies.fixture';

const EMPTY_TRIP = { studentName: null, onBoard: false, events: [] };

/**
 * "Minha viagem" (login USER): cada aluno vê só os próprios embarques e
 * desembarques de hoje. Os dados extras são criados dentro de cada teste: o
 * useTwoCompanies zera o banco antes de cada um.
 */
describe('Minha viagem — o aluno logado só vê o que é dele', () => {
  const ctx = useTwoCompanies();

  // Abrir a tela nunca muda nada em nenhuma das duas empresas.
  const tripOf = (userId: string, companyId: string | null) =>
    expectCompaniesUnchanged(
      ctx.prisma,
      [ctx.a.companyId, ctx.b.companyId],
      () => ctx.services.transport.getMyTripToday(userId, companyId),
    );
  const parentTrip = (tenant: TenantFixture) =>
    tripOf(tenant.users.parent.id, tenant.companyId);

  const createEvent = (
    tenant: TenantFixture,
    data: Partial<Prisma.TransportEventUncheckedCreateInput>,
  ) =>
    ctx.prisma.transportEvent.create({
      data: {
        companyId: tenant.companyId,
        deviceId: tenant.device.id,
        studentId: tenant.student.id,
        type: 'BOARDING',
        ...data,
      },
    });

  const createUser = (
    tenant: TenantFixture,
    login: string,
    studentId?: string,
  ) =>
    ctx.prisma.user.create({
      data: {
        companyId: tenant.companyId,
        studentId,
        role: UserRole.USER,
        name: `${login} ${tenant.label}`,
        email: `${login}@${tenant.key}.test`,
        password: `hash-${tenant.key}-${login}`,
      },
    });

  describe('entre empresas', () => {
    it.each([
      ['A', () => ctx.a, () => ctx.b],
      ['B', () => ctx.b, () => ctx.a],
    ])(
      'o USER de %s vê só o próprio embarque e nada da outra empresa',
      async (_label, own, other) => {
        const trip = await parentTrip(own());

        expect(trip).toEqual({
          studentName: own().student.name,
          onBoard: true,
          events: [
            {
              type: 'BOARDING',
              at: own().boarding.createdAt,
              busPlate: own().bus.plate,
            },
          ],
        });
        expectNoDataFrom(trip, other());
      },
    );

    it('o USER de B com a empresa A não vê nada', async () => {
      await expect(
        tripOf(ctx.b.users.parent.id, ctx.a.companyId),
      ).resolves.toEqual(EMPTY_TRIP);
    });

    it('o login de B continua vazio na empresa A, mesmo apontando para um aluno de A', async () => {
      // Dado inconsistente de propósito: login de B com aluno de A.
      await ctx.prisma.user.update({
        where: { id: ctx.b.users.parent.id },
        data: { studentId: ctx.a.spareStudent.id },
      });

      await expect(
        tripOf(ctx.b.users.parent.id, ctx.a.companyId),
      ).resolves.toEqual(EMPTY_TRIP);
    });

    it('login de A apontando para um aluno de B não mostra o aluno de B', async () => {
      // Dado inconsistente de propósito: login de A com aluno de B.
      await ctx.prisma.user.update({
        where: { id: ctx.a.users.parent.id },
        data: { studentId: ctx.b.spareStudent.id },
      });
      await createEvent(ctx.b, { studentId: ctx.b.spareStudent.id });

      const trip = await parentTrip(ctx.a);

      expect(trip).toEqual(EMPTY_TRIP);
      expectNoDataFrom(trip, ctx.b);
    });

    it('evento do aluno de A gravado na empresa B não aparece para ele', async () => {
      // Dado inconsistente de propósito: evento de B com aluno de A.
      await createEvent(ctx.b, {
        studentId: ctx.a.student.id,
        type: 'DEBOARDING',
      });

      const trip = await parentTrip(ctx.a);

      expect(trip.onBoard).toBe(true);
      expect(trip.events).toHaveLength(1);
      expectNoDataFrom(trip, ctx.b);
    });

    it('UniHub que foi para B: o embarque antigo de A aparece sem ônibus', async () => {
      await ctx.prisma.device.update({
        where: { id: ctx.a.device.id },
        data: { companyId: ctx.b.companyId, busId: ctx.b.bus.id },
      });

      const trip = await parentTrip(ctx.a);

      expect(trip.events).toEqual([
        {
          type: 'BOARDING',
          at: ctx.a.boarding.createdAt,
          busPlate: null,
        },
      ]);
      expectNoDataFrom(trip, ctx.b);
    });
  });

  describe('dentro da empresa A', () => {
    it('dois alunos: cada login vê só os próprios eventos', async () => {
      const otherUser = await createUser(
        ctx.a,
        'avulso-login',
        ctx.a.spareStudent.id,
      );
      const boarded = await createEvent(ctx.a, {
        studentId: ctx.a.spareStudent.id,
        type: 'BOARDING',
      });
      const left = await createEvent(ctx.a, {
        studentId: ctx.a.spareStudent.id,
        type: 'DEBOARDING',
      });

      const otherTrip = await tripOf(otherUser.id, ctx.a.companyId);
      expect(otherTrip.studentName).toBe(ctx.a.spareStudent.name);
      expect(otherTrip.onBoard).toBe(false);
      expect(otherTrip.events.map(({ type, at }) => ({ type, at }))).toEqual([
        { type: 'BOARDING', at: boarded.createdAt },
        { type: 'DEBOARDING', at: left.createdAt },
      ]);

      const trip = await parentTrip(ctx.a);
      expect(trip.studentName).toBe(ctx.a.student.name);
      expect(trip.onBoard).toBe(true);
      expect(trip.events.map(({ type, at }) => ({ type, at }))).toEqual([
        { type: 'BOARDING', at: ctx.a.boarding.createdAt },
      ]);
    });

    it('depois do desembarque, o aluno está fora do ônibus', async () => {
      const left = await createEvent(ctx.a, { type: 'DEBOARDING' });

      const trip = await parentTrip(ctx.a);

      expect(trip.onBoard).toBe(false);
      expect(trip.events.at(-1)).toEqual({
        type: 'DEBOARDING',
        at: left.createdAt,
        busPlate: ctx.a.bus.plate,
      });
    });

    it('leitura negada não aparece nem muda o estado', async () => {
      await createEvent(ctx.a, { type: 'DENIED' });

      const trip = await parentTrip(ctx.a);

      expect(trip.onBoard).toBe(true);
      expect(trip.events.map(({ type }) => type)).toEqual(['BOARDING']);
    });

    it('só hoje: 00:00 no fuso da aplicação entra, 1 ms antes não', async () => {
      const dayStart = getZonedDayStart(
        ctx.todayKey,
        getAppTimeZone(process.env.APP_TIMEZONE),
      );
      await createEvent(ctx.a, { createdAt: new Date(dayStart.getTime() - 1) });
      await createEvent(ctx.a, { createdAt: dayStart, type: 'DEBOARDING' });

      const trip = await parentTrip(ctx.a);

      expect(trip.events.map(({ type, at }) => ({ type, at }))).toEqual([
        { type: 'DEBOARDING', at: dayStart },
        { type: 'BOARDING', at: ctx.a.boarding.createdAt },
      ]);
    });

    it('a resposta não tem id, TAG nem credencial do UniHub', async () => {
      const text = JSON.stringify(await parentTrip(ctx.a));

      for (const secret of [
        ctx.a.student.id,
        ctx.a.device.id,
        ctx.a.device.code as string,
        ctx.a.device.secret as string,
        ctx.a.boarding.id,
        ctx.a.bus.id,
        ctx.a.rfidTag,
        ctx.a.companyId,
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });

  describe('estado vazio', () => {
    it('login USER sem aluno vinculado', async () => {
      const user = await createUser(ctx.a, 'sem-aluno');

      await expect(tripOf(user.id, ctx.a.companyId)).resolves.toEqual(
        EMPTY_TRIP,
      );
    });

    it('aluno inativo, mesmo com embarque hoje', async () => {
      await ctx.prisma.student.update({
        where: { id: ctx.a.student.id },
        data: { active: false },
      });

      await expect(parentTrip(ctx.a)).resolves.toEqual(EMPTY_TRIP);
    });

    it('login sem empresa', async () => {
      await expect(tripOf(ctx.platformAdmin.id, null)).resolves.toEqual(
        EMPTY_TRIP,
      );
    });

    it('login sem empresa apontando para um aluno de A', async () => {
      await ctx.prisma.user.update({
        where: { id: ctx.platformAdmin.id },
        data: { studentId: ctx.a.spareStudent.id },
      });

      await expect(tripOf(ctx.platformAdmin.id, null)).resolves.toEqual(
        EMPTY_TRIP,
      );
    });
  });
});
