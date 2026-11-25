import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TransportService } from './transport.service';

const COMPANY = 'company-1';
const device = {
  id: 'device-1',
  code: 'UNP-AAAA',
  secret: 's3cret',
  active: true,
  companyId: COMPANY,
};
const student = {
  id: 'student-1',
  name: 'Ana',
  active: true,
  companyId: COMPANY,
};
const card = {
  id: 'card-1',
  tag: '04A1B2C3D4',
  active: true,
  companyId: COMPANY,
  student,
};

function buildPrisma() {
  return {
    device: { findUnique: jest.fn().mockResolvedValue(device) },
    rfidCard: { findFirst: jest.fn().mockResolvedValue(card) },
    rfidCaptureSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    transportEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...data, createdAt: new Date() }),
      ),
    },
  };
}

describe('TransportService.handleIotRead', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: TransportService;
  const read = (rfidTag = '04:a1:b2:c3:d4', secret = device.secret) =>
    service.handleIotRead({ code: device.code, secret, rfidTag });

  beforeEach(() => {
    prisma = buildPrisma();
    service = new TransportService(
      prisma as unknown as PrismaService,
      new ConfigService(),
    );
  });

  it('recusa credencial errada com 404, sem criar evento', async () => {
    await expect(read(undefined, 'errado')).rejects.toThrow(NotFoundException);
    expect(prisma.transportEvent.create).not.toHaveBeenCalled();
  });

  it('sem evento anterior -> EMBARQUE (TAG normalizada)', async () => {
    const result = await read();

    expect(prisma.rfidCard.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tag: '04A1B2C3D4', companyId: COMPANY },
      }),
    );
    expect(result).toMatchObject({ status: 'AUTHORIZED', action: 'BOARDING' });
  });

  it('último evento BOARDING há mais de 5 s -> DESEMBARQUE', async () => {
    prisma.transportEvent.findFirst.mockResolvedValue({
      type: 'BOARDING',
      createdAt: new Date(Date.now() - 60_000),
    });

    await expect(read()).resolves.toMatchObject({
      status: 'AUTHORIZED',
      action: 'DEBOARDING',
    });
  });

  it('último evento DEBOARDING -> novo EMBARQUE (volta do dia)', async () => {
    prisma.transportEvent.findFirst.mockResolvedValue({
      type: 'DEBOARDING',
      createdAt: new Date(Date.now() - 60_000),
    });

    await expect(read()).resolves.toMatchObject({ action: 'BOARDING' });
  });

  it('leitura repetida em menos de 5 s é ignorada', async () => {
    prisma.transportEvent.findFirst.mockResolvedValue({
      type: 'BOARDING',
      createdAt: new Date(Date.now() - 1_000),
    });

    await expect(read()).resolves.toMatchObject({
      status: 'IGNORED',
      reason: 'REPEATED_READ',
    });
    expect(prisma.transportEvent.create).not.toHaveBeenCalled();
  });

  it('TAG desconhecida -> DENIED com log', async () => {
    prisma.rfidCard.findFirst.mockResolvedValue(null);

    await expect(read()).resolves.toMatchObject({
      status: 'DENIED',
      reason: 'UNKNOWN_TAG',
    });
    expect(prisma.transportEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'DENIED' }),
    });
  });

  it('TAG desativada -> DENIED (antes autorizava)', async () => {
    prisma.rfidCard.findFirst.mockResolvedValue({ ...card, active: false });

    await expect(read()).resolves.toMatchObject({
      status: 'DENIED',
      reason: 'INACTIVE_TAG',
    });
  });

  it('aluno inativo -> DENIED', async () => {
    prisma.rfidCard.findFirst.mockResolvedValue({
      ...card,
      student: { ...student, active: false },
    });

    await expect(read()).resolves.toMatchObject({
      status: 'DENIED',
      reason: 'INACTIVE_STUDENT',
    });
  });

  it('com captura aberta, só preenche a captura e não gera evento', async () => {
    prisma.rfidCaptureSession.findFirst.mockResolvedValue({ id: 'cap-1' });

    await expect(read()).resolves.toEqual({
      mode: 'CAPTURE',
      status: 'CAPTURED',
      tag: '04A1B2C3D4',
    });
    expect(prisma.rfidCaptureSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'cap-1', tag: null },
      data: expect.objectContaining({ tag: '04A1B2C3D4' }),
    });
    expect(prisma.rfidCard.findFirst).not.toHaveBeenCalled();
    expect(prisma.transportEvent.create).not.toHaveBeenCalled();
  });

  it('captura já preenchida por leitura concorrente cai no fluxo normal', async () => {
    prisma.rfidCaptureSession.findFirst.mockResolvedValue({ id: 'cap-1' });
    prisma.rfidCaptureSession.updateMany.mockResolvedValue({ count: 0 });

    await expect(read()).resolves.toMatchObject({ action: 'BOARDING' });
  });
});

describe('TransportService.getMyTripToday', () => {
  // 22:30 de 01/12 em Brasília (já é 02/12 em UTC).
  const NOW = new Date('2026-12-02T01:30:00.000Z');
  const USER_ID = 'user-1';
  const EMPTY_TRIP = { studentName: null, onBoard: false, events: [] };
  const bus = { id: 'bus-1', plate: 'ABC1D23', capacity: 40 };
  const eventDevice = {
    id: device.id,
    companyId: COMPANY as string | null,
    code: device.code,
    name: 'UniHub 1',
    bus,
  };

  // Só os dois modelos que a viagem consulta: qualquer outra consulta quebra
  // o teste, em vez de passar sem a verificação de empresa.
  const prisma = {
    user: { findFirst: jest.fn() },
    transportEvent: { findMany: jest.fn() },
  };
  const serviceIn = (timeZone: string) =>
    new TransportService(
      prisma as unknown as PrismaService,
      {
        get: (key: string) => (key === 'APP_TIMEZONE' ? timeZone : undefined),
      } as unknown as ConfigService,
    );
  const myTrip = (timeZone = 'America/Sao_Paulo') =>
    serviceIn(timeZone).getMyTripToday(USER_ID, COMPANY);
  const event = (type: string, at: string, from = eventDevice) => ({
    type,
    createdAt: new Date(at),
    device: from,
  });

  type Query = { where: Record<string, unknown>; orderBy?: unknown };
  const queriesOf = (mock: jest.Mock) =>
    (mock.mock.calls as [Query][]).map(([args]) => args);
  const eventQuery = () => queriesOf(prisma.transportEvent.findMany)[0];

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    prisma.user.findFirst.mockReset().mockResolvedValue({
      student: { id: student.id, name: student.name },
    });
    prisma.transportEvent.findMany.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('o que é consultado', () => {
    it('toda consulta leva o companyId do login', async () => {
      await myTrip();

      const queries = [
        ...queriesOf(prisma.user.findFirst),
        ...queriesOf(prisma.transportEvent.findMany),
      ];
      expect(queries).toHaveLength(2);
      expect(queries.map(({ where }) => where.companyId)).toEqual([
        COMPANY,
        COMPANY,
      ]);
    });

    it('o aluno é o do login: ativo e da mesma empresa', async () => {
      await myTrip();

      expect(queriesOf(prisma.user.findFirst)[0].where).toEqual({
        id: USER_ID,
        companyId: COMPANY,
        student: { companyId: COMPANY, active: true },
      });
    });

    it('os eventos são só os embarques e desembarques desse aluno, em ordem de horário', async () => {
      await myTrip();

      const { where, orderBy } = eventQuery();
      expect(Object.keys(where).sort()).toEqual([
        'companyId',
        'createdAt',
        'studentId',
        'type',
      ]);
      expect(where).toMatchObject({
        companyId: COMPANY,
        studentId: student.id,
        type: { in: ['BOARDING', 'DEBOARDING'] },
      });
      expect(orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  describe('"hoje" no fuso da aplicação', () => {
    it('America/Sao_Paulo: às 22h30 de 01/12 (02/12 em UTC) ainda é 01/12', async () => {
      await myTrip();

      expect(eventQuery().where.createdAt).toEqual({
        gte: new Date('2026-12-01T03:00:00.000Z'),
        lte: new Date('2026-12-02T02:59:59.999Z'),
      });
    });

    it('America/Manaus: o mesmo dia, uma hora depois em UTC', async () => {
      await myTrip('America/Manaus');

      expect(eventQuery().where.createdAt).toEqual({
        gte: new Date('2026-12-01T04:00:00.000Z'),
        lte: new Date('2026-12-02T03:59:59.999Z'),
      });
    });

    it('à meia-noite em Brasília, a janela já é a do dia seguinte', async () => {
      jest.setSystemTime(new Date('2026-12-02T03:00:00.000Z'));

      await myTrip();

      expect(eventQuery().where.createdAt).toEqual({
        gte: new Date('2026-12-02T03:00:00.000Z'),
        lte: new Date('2026-12-03T02:59:59.999Z'),
      });
    });
  });

  describe('o que volta', () => {
    it('último evento BOARDING: a bordo, só com nome, tipo, horário e ônibus', async () => {
      prisma.transportEvent.findMany.mockResolvedValue([
        event('BOARDING', '2026-12-01T10:00:00.000Z'),
        event('DEBOARDING', '2026-12-01T10:40:00.000Z'),
        event('BOARDING', '2026-12-01T21:00:00.000Z'),
      ]);

      await expect(myTrip()).resolves.toEqual({
        studentName: student.name,
        onBoard: true,
        events: [
          {
            type: 'BOARDING',
            at: new Date('2026-12-01T10:00:00.000Z'),
            busPlate: bus.plate,
          },
          {
            type: 'DEBOARDING',
            at: new Date('2026-12-01T10:40:00.000Z'),
            busPlate: bus.plate,
          },
          {
            type: 'BOARDING',
            at: new Date('2026-12-01T21:00:00.000Z'),
            busPlate: bus.plate,
          },
        ],
      });
    });

    it('último evento DEBOARDING: fora do ônibus', async () => {
      prisma.transportEvent.findMany.mockResolvedValue([
        event('BOARDING', '2026-12-01T10:00:00.000Z'),
        event('DEBOARDING', '2026-12-01T10:40:00.000Z'),
      ]);

      await expect(myTrip()).resolves.toMatchObject({ onBoard: false });
    });

    it('sem evento hoje: o nome do aluno, fora do ônibus e lista vazia', async () => {
      await expect(myTrip()).resolves.toEqual({
        studentName: student.name,
        onBoard: false,
        events: [],
      });
    });

    it.each([
      ['hoje é de outra empresa', { ...eventDevice, companyId: 'company-2' }],
      ['foi removido', { ...eventDevice, companyId: null }],
    ])('UniHub que %s: o evento aparece sem ônibus', async (_case, from) => {
      prisma.transportEvent.findMany.mockResolvedValue([
        event('BOARDING', '2026-12-01T10:00:00.000Z', from),
      ]);

      await expect(myTrip()).resolves.toMatchObject({
        onBoard: true,
        events: [{ type: 'BOARDING', busPlate: null }],
      });
    });
  });

  describe('estado vazio', () => {
    it.each([
      ['não achou login da empresa com aluno ativo', null],
      ['login sem aluno', { student: null }],
    ])('%s: nenhum evento é consultado', async (_case, login) => {
      prisma.user.findFirst.mockResolvedValue(login);

      await expect(myTrip()).resolves.toEqual(EMPTY_TRIP);
      expect(prisma.transportEvent.findMany).not.toHaveBeenCalled();
    });

    it('login sem empresa: nenhuma consulta é feita', async () => {
      await expect(
        serviceIn('America/Sao_Paulo').getMyTripToday(USER_ID, null),
      ).resolves.toEqual(EMPTY_TRIP);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.transportEvent.findMany).not.toHaveBeenCalled();
    });
  });
});
