import {
  BillingChargeStatus,
  PushNotificationProvider,
  ScheduleType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  getAppTimeZone,
  getZonedDateParts,
} from 'src/notifications/notification-time.util';
import { getScheduleMetadata } from 'src/route-schedules/schedule-metadata.util';
import { fingerprintsOf, snapshotCompany } from './company-snapshot';
import { TEST_BILLING_KEY } from './billing-test-key';
import { onlyDigits, protectDocument } from 'src/billing/billing-document.util';

type TenantSpec = {
  /** Aparece em todo texto da empresa; o canário procura por ele. */
  key: 'alfa' | 'bravo';
  label: 'Alfa' | 'Bravo';
  cnpj: string;
  rfidTag: string;
  customerDocument: string;
  pairingCode: string;
};

const SPECS: Record<'a' | 'b', TenantSpec> = {
  a: {
    key: 'alfa',
    label: 'Alfa',
    cnpj: '11111111000111',
    rfidTag: 'AA00AA01',
    customerDocument: '111.111.111-11',
    pairingCode: 'A0A0A0',
  },
  b: {
    key: 'bravo',
    label: 'Bravo',
    cnpj: '22222222000122',
    rfidTag: 'BB00BB01',
    customerDocument: '222.222.222-22',
    pairingCode: 'B0B0B0',
  },
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MINUTE_MS = 60_000;

export type TenantFixture = Awaited<ReturnType<typeof seedTenant>> & {
  /** Ids de todas as linhas da empresa + textos que só ela tem. */
  fingerprints: string[];
};

export type TwoCompanies = Awaited<ReturnType<typeof seedTwoCompanies>>;

async function seedTenant(
  prisma: PrismaService,
  spec: TenantSpec,
  now: Date,
  todayKey: string,
) {
  const { key, label } = spec;
  const code = key.toUpperCase();

  const company = await prisma.company.create({
    data: {
      name: `Transportes ${label}`,
      cnpj: spec.cnpj,
      emailDomain: `${key}.test`,
      contactName: `Contato ${label}`,
    },
  });
  const companyId = company.id;

  await prisma.companyBillingSettings.create({
    data: {
      companyId,
      gatewayContactName: `Financeiro ${label}`,
      gatewayContactEmail: `financeiro@${key}.test`,
      legalEntityName: `Razão Social ${label}`,
      legalDocument: spec.cnpj,
      bankInfoSummary: `Banco ${label}`,
    },
  });

  // Senha não é testada aqui; o hash é só um texto identificável.
  const createUser = (role: UserRole, login: string, studentId?: string) =>
    prisma.user.create({
      data: {
        companyId,
        studentId,
        role,
        name: `${login} ${label}`,
        email: `${login}@${key}.test`,
        password: `hash-${key}-${login}`,
      },
    });

  const admin = await createUser(UserRole.ADMIN, 'admin');
  const driver = await createUser(UserRole.DRIVER, 'motorista');

  const group = await prisma.group.create({
    data: { companyId, name: `Turma ${label}`, nameNormalized: `turma ${key}` },
  });
  const route = await prisma.route.create({
    data: { companyId, name: `Rota ${label}`, description: `Linha ${label}` },
  });
  const bus = await prisma.bus.create({
    data: { companyId, plate: `${code}-001`, capacity: 40 },
  });
  // Sem nenhum vínculo: pode ser excluído fisicamente nos testes de lote.
  const spareBus = await prisma.bus.create({
    data: { companyId, plate: `${code}-002`, capacity: 20 },
  });

  const device = await prisma.device.create({
    data: {
      companyId,
      busId: bus.id,
      hardwareId: `HW-${code}-1`,
      code: `UNP-${code}-1`,
      secret: `secret-${key}-1`,
      name: bus.plate,
      pairedAt: now,
      lastLat: -23.55,
      lastLng: -46.63,
      lastUpdate: now,
    },
  });
  // Vinculado pelo painel, esperando o aparelho buscar as credenciais.
  const pendingDevice = await prisma.device.create({
    data: {
      companyId,
      busId: bus.id,
      hardwareId: `HW-${code}-2`,
      code: `UNP-${code}-2`,
      secret: `secret-${key}-2`,
      name: bus.plate,
      pairingCode: spec.pairingCode,
      pairingCodeExpiresAt: new Date(now.getTime() + 10 * MINUTE_MS),
    },
  });

  // Horário de rota em UTC, como o RouteSchedulesService grava.
  const departureTime = new Date(Date.UTC(1970, 0, 1, 7, 0, 0));
  const schedule = await prisma.routeSchedule.create({
    data: {
      routeId: route.id,
      busId: bus.id,
      type: ScheduleType.GO,
      title: `Ida ${label}`,
      departureTime,
      dayOfWeeks: ALL_DAYS,
      notifyBeforeMinutes: 30,
      ...getScheduleMetadata({
        departureTime,
        dayOfWeeks: ALL_DAYS,
        notifyBeforeMinutes: 30,
      }),
    },
  });

  const billingTemplate = await prisma.billingTemplate.create({
    data: {
      companyId,
      name: `Mensalidade ${label}`,
      description: `Grupo de boletos ${label}`,
      amountCents: 30_000,
      dueDay: 10,
    },
  });

  const student = await prisma.student.create({
    data: {
      companyId,
      groupId: group.id,
      billingTemplateId: billingTemplate.id,
      name: `Aluno ${label}`,
      registration: `${code}-001`,
      email: `aluno@${key}.test`,
      phone: '+5511900000001',
      routes: { create: [{ routeId: route.id }] },
    },
  });
  // Só com grupo: sem rota, TAG, boleto nem evento (pode ser excluído).
  const spareStudent = await prisma.student.create({
    data: {
      companyId,
      groupId: group.id,
      name: `Aluno Avulso ${label}`,
      registration: `${code}-002`,
      email: `avulso@${key}.test`,
    },
  });

  const parent = await createUser(UserRole.USER, 'responsavel', student.id);

  const rfidCard = await prisma.rfidCard.create({
    data: { companyId, studentId: student.id, tag: spec.rfidTag },
  });

  const billingCustomer = await prisma.billingCustomer.create({
    data: {
      companyId,
      studentId: student.id,
      name: `Responsável Financeiro ${label}`,
      email: `pagador@${key}.test`,
      // Como a API grava: cifrado + hash + máscara, nunca em texto puro.
      ...protectDocument(onlyDigits(spec.customerDocument), TEST_BILLING_KEY),
      phone: '+5511900000002',
    },
  });
  const charge = await prisma.billingCharge.create({
    data: {
      companyId,
      templateId: billingTemplate.id,
      ownerUserId: parent.id,
      studentId: student.id,
      customerId: billingCustomer.id,
      recipientName: billingCustomer.name,
      recipientEmail: billingCustomer.email,
      recipientDocument: billingCustomer.documentMasked,
      description: `Mensalidade ${label} - 09/2026`,
      amountCents: billingTemplate.amountCents,
      issueDate: new Date(Date.UTC(2026, 8, 1, 12)),
      dueDate: new Date(Date.UTC(2026, 8, 10, 12)),
      status: BillingChargeStatus.ISSUED,
      externalReference: `ref-${key}-1`,
    },
  });

  const boarding = await prisma.transportEvent.create({
    data: {
      companyId,
      type: 'BOARDING',
      studentId: student.id,
      rfidCardId: rfidCard.id,
      deviceId: device.id,
    },
  });
  const captureSession = await prisma.rfidCaptureSession.create({
    data: {
      companyId,
      deviceId: device.id,
      requestedById: admin.id,
      expiresAt: new Date(now.getTime() + MINUTE_MS),
    },
  });

  const prompt = await prisma.notificationPrompt.create({
    data: {
      userId: parent.id,
      scheduleId: schedule.id,
      occurrenceKey: todayKey,
      message: `Aviso ${label}`,
    },
  });
  const confirmation = await prisma.scheduleConfirmation.create({
    data: {
      userId: parent.id,
      scheduleId: schedule.id,
      occurrenceKey: todayKey,
      willGo: true,
    },
  });
  const pushSubscription = await prisma.pushSubscription.create({
    data: {
      userId: parent.id,
      provider: PushNotificationProvider.EXPO,
      token: `ExponentPushToken[${key}-1]`,
      installationKey: `inst-${key}-1`,
      deviceName: `Celular ${label}`,
    },
  });

  return {
    ...spec,
    companyId,
    users: { admin, driver, parent },
    group,
    route,
    bus,
    spareBus,
    device,
    pendingDevice,
    schedule,
    billingTemplate,
    student,
    spareStudent,
    rfidCard,
    billingCustomer,
    charge,
    boarding,
    captureSession,
    prompt,
    confirmation,
    pushSubscription,
  };
}

/**
 * Duas empresas com o mesmo formato. Tudo da empresa B tem "Bravo" no texto,
 * e as impressões digitais de cada uma incluem os ids de todas as linhas dela.
 */
export async function seedTwoCompanies(prisma: PrismaService) {
  const now = new Date();
  const todayKey = getZonedDateParts(
    now,
    getAppTimeZone(process.env.APP_TIMEZONE),
  ).dateKey;

  const withFingerprints = async (spec: TenantSpec): Promise<TenantFixture> => {
    const tenant = await seedTenant(prisma, spec, now, todayKey);
    const snapshot = await snapshotCompany(prisma, tenant.companyId);

    return {
      ...tenant,
      fingerprints: fingerprintsOf(snapshot, [
        spec.key,
        spec.cnpj,
        spec.rfidTag,
        spec.customerDocument,
      ]),
    };
  };

  const a = await withFingerprints(SPECS.a);
  const b = await withFingerprints(SPECS.b);

  // Fora das duas empresas: aparelho ainda sem dono e o dono da plataforma.
  const orphanDevice = await prisma.device.create({
    data: {
      hardwareId: 'HW-ORFAO-1',
      pairingCode: 'F0F0F0',
      pairingCodeExpiresAt: new Date(now.getTime() + 10 * MINUTE_MS),
    },
  });
  const platformAdmin = await prisma.user.create({
    data: {
      role: UserRole.PLATFORM_ADMIN,
      name: 'Dono da Plataforma',
      email: 'plataforma@unipass.test',
      password: 'hash-plataforma',
    },
  });

  return { a, b, orphanDevice, platformAdmin, todayKey };
}
