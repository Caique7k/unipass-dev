import {
  deviceForCompany,
  EventDevice,
  eventsSeenByCompany,
  onCompanyBus,
} from './event-device.util';

const COMPANY = 'company-1';
const OTHER_COMPANY = 'company-2';

const device: EventDevice = {
  id: 'device-1',
  companyId: COMPANY,
  code: 'UNP-AAAA',
  name: 'ABC1D23',
  bus: { id: 'bus-1', plate: 'ABC1D23', capacity: 40 },
};

// Como um UniHub fica depois de "Remover" (DevicesService.deleteMany).
const removed = {
  id: 'device-1',
  companyId: null,
  code: null,
  name: null,
  bus: null,
};

describe('deviceForCompany', () => {
  it('aparelho da empresa do evento aparece como está', () => {
    expect(deviceForCompany(device, COMPANY)).toBe(device);
  });

  it('aparelho que hoje é de outra empresa aparece como removido, mantendo o id', () => {
    expect(
      deviceForCompany({ ...device, companyId: OTHER_COMPANY }, COMPANY),
    ).toEqual(removed);
  });

  it('aparelho removido e ainda sem empresa continua igual', () => {
    expect(deviceForCompany(removed, COMPANY)).toEqual(removed);
  });
});

describe('eventsSeenByCompany', () => {
  it('troca só o aparelho de cada evento e mantém o resto', () => {
    const events = [
      { id: 'event-1', type: 'BOARDING', device },
      {
        id: 'event-2',
        type: 'BOARDING',
        device: { ...device, companyId: OTHER_COMPANY },
      },
    ];

    expect(eventsSeenByCompany(events, COMPANY)).toEqual([
      { id: 'event-1', type: 'BOARDING', device },
      { id: 'event-2', type: 'BOARDING', device: removed },
    ]);
  });
});

describe('onCompanyBus', () => {
  it('filtra pelo ônibus atual só entre aparelhos da própria empresa', () => {
    expect(onCompanyBus(COMPANY, 'bus-1')).toEqual({
      device: { companyId: COMPANY, busId: 'bus-1' },
    });
  });
});
