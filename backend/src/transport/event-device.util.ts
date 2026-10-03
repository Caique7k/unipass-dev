import { Prisma } from '@prisma/client';

/*
 * Um TransportEvent guarda só o aparelho que fez a leitura, e o aparelho guarda
 * apenas a instalação de hoje (empresa, ônibus, nome, código). Depois de
 * "Remover", o mesmo aparelho pode ser pareado de novo em outra empresa: para a
 * empresa dos eventos antigos, ele passa a valer como UniHub removido.
 */

/** Campos do aparelho que as telas de histórico leem. */
export const eventDeviceSelect = {
  id: true,
  companyId: true,
  code: true,
  name: true,
  bus: {
    select: {
      id: true,
      plate: true,
      capacity: true,
    },
  },
} satisfies Prisma.DeviceSelect;

export type EventDevice = Prisma.DeviceGetPayload<{
  select: typeof eventDeviceSelect;
}>;

/** O aparelho de um evento como a empresa do evento deve vê-lo. */
export function deviceForCompany(
  device: EventDevice,
  companyId: string,
): EventDevice {
  if (device.companyId === companyId) {
    return device;
  }

  // Os mesmos campos que o DevicesService.deleteMany zera ao remover um UniHub.
  return { ...device, companyId: null, code: null, name: null, bus: null };
}

/** Os eventos com o aparelho de cada um como a empresa dos eventos deve vê-lo. */
export function eventsSeenByCompany<T extends { device: EventDevice }>(
  events: T[],
  companyId: string,
): Array<Omit<T, 'device'> & { device: EventDevice }> {
  return events.map((event) => ({
    ...event,
    device: deviceForCompany(event.device, companyId),
  }));
}

/**
 * Filtro "eventos do ônibus X". O ônibus vem da instalação atual do aparelho,
 * então só conta aparelho que ainda é da empresa dos eventos.
 */
export function onCompanyBus(
  companyId: string,
  busId: Prisma.DeviceWhereInput['busId'],
): Prisma.TransportEventWhereInput {
  return { device: { companyId, busId } };
}
