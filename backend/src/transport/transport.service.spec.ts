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
