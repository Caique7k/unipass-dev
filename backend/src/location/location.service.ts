import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { safeCompareStrings } from 'src/security/secure-compare.util';
import { DeviceTelemetryDto } from './dto/device-telemetry.dto';

const DEVICE_ONLINE_THRESHOLD_MS = 45_000;
const liveLocationDeviceSelect = {
  id: true,
  code: true,
  name: true,
  active: true,
  busId: true,
  pairedAt: true,
  lastUpdate: true,
  createdAt: true,
  lastLat: true,
  lastLng: true,
} satisfies Prisma.DeviceSelect;

@Injectable()
export class LocationService {
  constructor(private readonly prisma: PrismaService) {}

  async updateDeviceTelemetry(dto: DeviceTelemetryDto) {
    const device = await this.prisma.device.findUnique({
      where: { code: dto.code },
    });

    if (!device || !safeCompareStrings(device.secret, dto.secret)) {
      throw new NotFoundException('Credenciais do dispositivo invalidas');
    }

    if (!device.active) {
      throw new BadRequestException('Dispositivo inativo');
    }

    if (!device.companyId) {
      throw new BadRequestException('Dispositivo ainda nao vinculado');
    }

    const updatedDevice = await this.prisma.device.update({
      where: { id: device.id },
      data: {
        lastLat: dto.latitude,
        lastLng: dto.longitude,
        lastUpdate: new Date(),
      },
    });

    return {
      success: true,
      deviceId: updatedDevice.id,
      lastUpdate: updatedDevice.lastUpdate,
    };
  }

  async getLiveBusLocation(companyId: string, busId: string) {
    const bus = await this.prisma.bus.findFirst({
      where: {
        id: busId,
        companyId,
      },
    });

    if (!bus) {
      throw new NotFoundException('Onibus nao encontrado');
    }

    // Com mais de um UniHub no ônibus, vale o ativo com a telemetria mais
    // recente. Sem o nulls: 'last', o PostgreSQL põe primeiro quem nunca
    // mandou posição (lastUpdate nulo), e ele esconderia o que está mandando.
    const linkedDevice = await this.prisma.device.findFirst({
      where: {
        companyId,
        busId,
        active: true,
      },
      orderBy: [
        { lastUpdate: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: liveLocationDeviceSelect,
    });

    // Nenhum UniHub ativo no ônibus.
    if (!linkedDevice) {
      return {
        bus,
        linkedDevice: null,
        state: 'needs-pairing',
        telemetry: null,
      };
    }

    const { lastLat, lastLng, lastUpdate } = linkedDevice;

    // O UniHub ainda não mandou posição.
    if (lastLat === null || lastLng === null || !lastUpdate) {
      return {
        bus,
        linkedDevice,
        state: 'no-online-device',
        telemetry: null,
      };
    }

    const isOnline =
      Date.now() - lastUpdate.getTime() <= DEVICE_ONLINE_THRESHOLD_MS;

    return {
      bus,
      linkedDevice,
      state: isOnline ? 'live' : 'stale',
      telemetry: {
        latitude: lastLat,
        longitude: lastLng,
        lastUpdate,
      },
    };
  }
}
