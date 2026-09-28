import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { safeCompareStrings } from 'src/security/secure-compare.util';
import { ClaimDevicePairingDto } from './dto/claim-device-pairing.dto';
import { DeleteDevicesDto } from './dto/delete-devices.dto';
import { LinkDeviceDto } from './dto/link-device.dto';
import { ListDevicesDto } from './dto/find-devices.dto';
import { LinkDeviceBusDto } from './dto/link-device-bus.dto';
import { StartDevicePairingDto } from './dto/start-device-pairing.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

const PAIRING_TTL_MINUTES = 10;

function generateCode() {
  return `UNP-${randomBytes(4).toString('hex').toUpperCase()}`;
}

function generateSecret() {
  return randomBytes(16).toString('hex');
}

function generatePairingCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

// Estado "de fábrica": só o hardwareId continua identificando o aparelho.
const RELEASED_DEVICE_DATA = {
  companyId: null,
  busId: null,
  code: null,
  secret: null,
  name: null,
  pairedAt: null,
  pairingCode: null,
  pairingCodeExpiresAt: null,
  lastLat: null,
  lastLng: null,
  lastUpdate: null,
  active: true,
} satisfies Prisma.DeviceUncheckedUpdateManyInput;

const deviceSafeSelect = {
  id: true,
  code: true,
  name: true,
  active: true,
  companyId: true,
  busId: true,
  pairedAt: true,
  lastUpdate: true,
  createdAt: true,
  bus: {
    select: {
      id: true,
      plate: true,
      capacity: true,
    },
  },
} satisfies Prisma.DeviceSelect;

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateUniqueDeviceCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const existingDevice = await this.prisma.device.findUnique({
        where: { code },
      });

      if (!existingDevice) {
        return code;
      }
    }

    throw new BadRequestException(
      'Não foi possível gerar um código único para o dispositivo.',
    );
  }

  private async generateUniquePairingCode() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const pairingCode = generatePairingCode();
      const existingDevice = await this.prisma.device.findUnique({
        where: { pairingCode },
      });

      if (!existingDevice) {
        return pairingCode;
      }
    }

    throw new BadRequestException(
      'Não foi possível gerar um código temporário para o dispositivo.',
    );
  }

  private getPairingExpiresAt() {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + PAIRING_TTL_MINUTES);
    return expiresAt;
  }

  private isPairingValid(device: {
    pairingCode: string | null;
    pairingCodeExpiresAt: Date | null;
  }) {
    return Boolean(
      device.pairingCode &&
      device.pairingCodeExpiresAt &&
      device.pairingCodeExpiresAt > new Date(),
    );
  }

  async startPairing(dto: StartDevicePairingDto) {
    const existingDevice = await this.prisma.device.findUnique({
      where: { hardwareId: dto.hardwareId },
    });

    if (!existingDevice) {
      const pairingCode = await this.generateUniquePairingCode();
      const device = await this.prisma.device.create({
        data: {
          hardwareId: dto.hardwareId,
          pairingCode,
          pairingCodeExpiresAt: this.getPairingExpiresAt(),
          active: true,
        },
      });

      return {
        hardwareId: device.hardwareId,
        pairingCode: device.pairingCode,
        pairingCodeExpiresAt: device.pairingCodeExpiresAt,
        linked: false,
        credentialsReady: false,
      };
    }

    if (!existingDevice.active) {
      throw new BadRequestException('Device inativo');
    }

    if (
      existingDevice.code &&
      existingDevice.secret &&
      existingDevice.pairedAt
    ) {
      return {
        hardwareId: existingDevice.hardwareId,
        linked: Boolean(existingDevice.companyId),
        credentialsReady: true,
        alreadyPaired: true,
      };
    }

    if (this.isPairingValid(existingDevice)) {
      return {
        hardwareId: existingDevice.hardwareId,
        pairingCode: existingDevice.pairingCode,
        pairingCodeExpiresAt: existingDevice.pairingCodeExpiresAt,
        linked: Boolean(existingDevice.companyId),
        credentialsReady: Boolean(
          existingDevice.companyId &&
          existingDevice.code &&
          existingDevice.secret,
        ),
      };
    }

    const pairingCode = await this.generateUniquePairingCode();
    const device = await this.prisma.device.update({
      where: { id: existingDevice.id },
      data: {
        pairingCode,
        pairingCodeExpiresAt: this.getPairingExpiresAt(),
      },
    });

    return {
      hardwareId: device.hardwareId,
      pairingCode: device.pairingCode,
      pairingCodeExpiresAt: device.pairingCodeExpiresAt,
      linked: Boolean(device.companyId),
      credentialsReady: Boolean(
        device.companyId && device.code && device.secret,
      ),
    };
  }

  async claimPairing(dto: ClaimDevicePairingDto) {
    const device = await this.prisma.device.findUnique({
      where: { hardwareId: dto.hardwareId },
    });

    if (!device) {
      throw new NotFoundException('Dispositivo não encontrado.');
    }

    if (!device.active) {
      throw new BadRequestException('Device inativo');
    }

    if (
      !safeCompareStrings(device.pairingCode, dto.pairingCode) ||
      !device.pairingCodeExpiresAt ||
      device.pairingCodeExpiresAt <= new Date()
    ) {
      throw new BadRequestException('Código temporário inválido ou expirado.');
    }

    if (!device.companyId || !device.code || !device.secret) {
      return {
        linked: false,
        credentialsReady: false,
      };
    }

    const updatedDevice = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        pairedAt: new Date(),
        pairingCode: null,
        pairingCodeExpiresAt: null,
      },
    });

    return {
      linked: true,
      credentialsReady: true,
      code: updatedDevice.code,
      secret: updatedDevice.secret,
      name: updatedDevice.name,
      companyId: updatedDevice.companyId,
    };
  }

  async linkDevice(user, dto: LinkDeviceDto) {
    const device = await this.prisma.device.findUnique({
      where: { pairingCode: dto.pairingCode },
    });

    if (
      !device ||
      !device.pairingCodeExpiresAt ||
      device.pairingCodeExpiresAt <= new Date()
    ) {
      throw new NotFoundException(
        'Código temporário não encontrado ou expirado.',
      );
    }

    if (device.companyId && device.companyId !== user.companyId) {
      throw new BadRequestException(
        'Dispositivo já vinculado a outra empresa.',
      );
    }

    const bus = await this.prisma.bus.findFirst({
      where: {
        id: dto.busId,
        companyId: user.companyId,
      },
    });

    if (!bus) {
      throw new NotFoundException('Ônibus não encontrado.');
    }

    const data: {
      companyId?: string;
      name: string;
      busId: string;
      code?: string;
      secret?: string;
    } = {
      name: bus.plate,
      busId: bus.id,
    };

    if (!device.companyId) {
      data.companyId = user.companyId;
    }

    if (!device.code) {
      data.code = await this.generateUniqueDeviceCode();
    }

    if (!device.secret) {
      data.secret = generateSecret();
    }

    return this.prisma.device.update({
      where: { id: device.id },
      data,
      select: deviceSafeSelect,
    });
  }

  async findAll(user, query: ListDevicesDto) {
    const { page = 1, limit = 10, search, active } = query;

    const where: any = {
      companyId: user.companyId,
    };

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          code: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          hardwareId: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (active !== undefined) {
      where.active = active;
    }

    const [data, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        skip: (page - 1) * limit,
        take: Number(limit),
        select: deviceSafeSelect,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.device.count({ where }),
    ]);

    return {
      data,
      lastPage: Math.ceil(total / limit),
    };
  }

  /**
   * "Excluir" um UniHub = liberar o aparelho físico: sai do ônibus e da
   * empresa e perde code/secret. O firmware recebe 404 na próxima chamada,
   * volta sozinho ao pareamento e pode ser pareado de novo (nesta ou em outra
   * empresa). A linha do Device fica, porque TransportEvent aponta para ela e
   * carrega o próprio companyId — o histórico da empresa não se perde.
   *
   * Antes isto só marcava active=false, deixando o aparelho preso à empresa e
   * ao ônibus e recusado até no pareamento, sem caminho de volta.
   */
  async deleteMany(user, dto: DeleteDevicesDto) {
    const now = new Date();
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: dto.ids },
        companyId: user.companyId,
      },
      select: { id: true },
    });

    if (devices.length === 0) {
      throw new NotFoundException(
        'Nenhum dispositivo encontrado para remover.',
      );
    }

    const ids = devices.map((device) => device.id);

    const [, result] = await this.prisma.$transaction([
      this.prisma.rfidCaptureSession.updateMany({
        where: { deviceId: { in: ids }, tag: null, cancelledAt: null },
        data: { cancelledAt: now },
      }),
      this.prisma.device.updateMany({
        where: { id: { in: ids } },
        data: RELEASED_DEVICE_DATA,
      }),
    ]);

    return result;
  }

  async update(user, id: string, dto: UpdateDeviceDto) {
    const device = await this.prisma.device.findFirst({
      where: {
        id,
        companyId: user.companyId,
      },
    });

    if (!device) {
      throw new NotFoundException('Dispositivo não encontrado.');
    }

    return this.prisma.device.update({
      where: { id },
      data: {
        name: dto.name,
      },
      select: deviceSafeSelect,
    });
  }

  async linkBus(user, id: string, dto: LinkDeviceBusDto) {
    const [device, bus] = await Promise.all([
      this.prisma.device.findFirst({
        where: {
          id,
          companyId: user.companyId,
        },
      }),
      this.prisma.bus.findFirst({
        where: {
          id: dto.busId,
          companyId: user.companyId,
        },
      }),
    ]);

    if (!device) {
      throw new NotFoundException('Dispositivo não encontrado.');
    }

    if (!bus) {
      throw new NotFoundException('Ônibus não encontrado.');
    }

    return this.prisma.device.update({
      where: { id },
      data: {
        busId: dto.busId,
        name: bus.plate,
      },
      select: deviceSafeSelect,
    });
  }
}
