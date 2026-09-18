import 'dotenv/config';
import {
  BillingChargeStatus,
  BillingEventSource,
  BillingGatewayMode,
  BillingOnboardingStatus,
  BillingTargetScope,
  BillingTemplateRecurrence,
  CompanyPlan,
  EventType,
  NotificationChannel,
  NotificationPromptStatus,
  PrismaClient,
  PushNotificationProvider,
  PushPlatform,
  ScheduleType,
  TripStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

function normalizeDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return;

  const url = new URL(rawUrl);
  const encodeCredential = (value: string) =>
    encodeURIComponent(decodeURIComponent(value)).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const username = encodeCredential(url.username);
  const password = encodeCredential(url.password);
  process.env.DATABASE_URL = `${url.protocol}//${username}:${password}@${url.host}${url.pathname}${url.search}`;
}

normalizeDatabaseUrl();
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

const ids = {
  companies: {
    main: '10000000-0000-4000-8000-000000000001',
    growth: '10000000-0000-4000-8000-000000000002',
    scale: '10000000-0000-4000-8000-000000000003',
  },
  groups: {
    morning: '20000000-0000-4000-8000-000000000001',
    afternoon: '20000000-0000-4000-8000-000000000002',
  },
  students: {
    ana: '30000000-0000-4000-8000-000000000001',
    bruno: '30000000-0000-4000-8000-000000000002',
    carla: '30000000-0000-4000-8000-000000000003',
  },
  users: {
    platform: '40000000-0000-4000-8000-000000000001',
    admin: '40000000-0000-4000-8000-000000000002',
    driver: '40000000-0000-4000-8000-000000000003',
    student: '40000000-0000-4000-8000-000000000004',
    coordinator: '40000000-0000-4000-8000-000000000005',
  },
  buses: {
    one: '50000000-0000-4000-8000-000000000001',
    two: '50000000-0000-4000-8000-000000000002',
  },
  devices: {
    paired: '60000000-0000-4000-8000-000000000001',
    available: '60000000-0000-4000-8000-000000000002',
  },
  cards: {
    ana: '70000000-0000-4000-8000-000000000001',
    bruno: '70000000-0000-4000-8000-000000000002',
    spare: '70000000-0000-4000-8000-000000000003',
  },
  routes: {
    school: '80000000-0000-4000-8000-000000000001',
    return: '80000000-0000-4000-8000-000000000002',
  },
  schedules: {
    go: '81000000-0000-4000-8000-000000000001',
    back: '81000000-0000-4000-8000-000000000002',
    shift: '81000000-0000-4000-8000-000000000003',
  },
  trips: {
    active: '90000000-0000-4000-8000-000000000001',
    finished: '90000000-0000-4000-8000-000000000002',
    cancelled: '90000000-0000-4000-8000-000000000003',
  },
  billingSettings: 'a0000000-0000-4000-8000-000000000001',
  templates: {
    monthly: 'a1000000-0000-4000-8000-000000000001',
    bimonthly: 'a1000000-0000-4000-8000-000000000002',
    quarterly: 'a1000000-0000-4000-8000-000000000003',
    semiannual: 'a1000000-0000-4000-8000-000000000004',
    yearly: 'a1000000-0000-4000-8000-000000000005',
  },
  customers: {
    ana: 'a2000000-0000-4000-8000-000000000001',
    bruno: 'a2000000-0000-4000-8000-000000000002',
  },
};

const daysAgo = (days: number, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

const daysFromNow = (days: number, hour = 12) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
};

async function main() {
  const password = await bcrypt.hash('123456', 10);
  const now = new Date();

  console.log('🌱 Iniciando seed do UniPass...');

  const company = await prisma.company.upsert({
    where: { id: ids.companies.main },
    update: {
      name: 'Colégio Horizonte',
      cnpj: '12345678000190',
      emailDomain: 'horizonte.edu.br',
      plan: CompanyPlan.SCALE,
      contactName: 'Mariana Costa',
      contactPhone: '+5511999990001',
      smsVerifiedAt: daysAgo(30),
    },
    create: {
      id: ids.companies.main,
      name: 'Colégio Horizonte',
      cnpj: '12345678000190',
      emailDomain: 'horizonte.edu.br',
      plan: CompanyPlan.SCALE,
      contactName: 'Mariana Costa',
      contactPhone: '+5511999990001',
      smsVerifiedAt: daysAgo(30),
    },
  });

  await prisma.company.upsert({
    where: { id: ids.companies.growth },
    update: {},
    create: {
      id: ids.companies.growth,
      name: 'Escola Caminhos',
      cnpj: '23456789000101',
      emailDomain: 'caminhos.edu.br',
      plan: CompanyPlan.GROWTH,
      requestedPlan: CompanyPlan.SCALE,
      planChangeRequestedAt: daysAgo(2),
      planChangeRequestedByName: 'Paulo Lima',
      planChangeRequestedByEmail: 'paulo@caminhos.edu.br',
    },
  });

  await prisma.company.upsert({
    where: { id: ids.companies.scale },
    update: {},
    create: {
      id: ids.companies.scale,
      name: 'Instituto Saber',
      cnpj: '34567890000112',
      emailDomain: 'saber.edu.br',
      plan: CompanyPlan.ESSENTIAL,
    },
  });

  const userRows = [
    {
      id: ids.users.platform,
      name: 'Administrador da Plataforma',
      email: 'platform@unipass.dev',
      role: UserRole.PLATFORM_ADMIN,
      companyId: null,
      studentId: null,
    },
    {
      id: ids.users.admin,
      name: 'Mariana Costa',
      email: 'admin@horizonte.edu.br',
      role: UserRole.ADMIN,
      companyId: company.id,
      studentId: null,
    },
    {
      id: ids.users.driver,
      name: 'Carlos Motorista',
      email: 'motorista@horizonte.edu.br',
      role: UserRole.DRIVER,
      companyId: company.id,
      studentId: null,
    },
    {
      id: ids.users.coordinator,
      name: 'Fernanda Coordenadora',
      email: 'coordenacao@horizonte.edu.br',
      role: UserRole.COORDINATOR,
      companyId: company.id,
      studentId: null,
    },
  ];

  for (const user of userRows) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email, password, role: user.role, active: true },
      create: { ...user, password, active: true },
    });
  }

  const groups = [
    { id: ids.groups.morning, name: 'Turma da Manhã', nameNormalized: 'turma da manha' },
    { id: ids.groups.afternoon, name: 'Turma da Tarde', nameNormalized: 'turma da tarde' },
  ];
  for (const group of groups) {
    await prisma.group.upsert({
      where: { id: group.id },
      update: { ...group, active: true },
      create: { ...group, companyId: company.id, active: true },
    });
  }

  await prisma.companyBillingSettings.upsert({
    where: { companyId: company.id },
    update: {
      gatewayMode: BillingGatewayMode.PLATFORM_GATEWAY,
      onboardingStatus: BillingOnboardingStatus.ACTIVE,
    },
    create: {
      id: ids.billingSettings,
      companyId: company.id,
      gatewayMode: BillingGatewayMode.PLATFORM_GATEWAY,
      onboardingStatus: BillingOnboardingStatus.ACTIVE,
      gatewayContactName: 'Mariana Costa',
      gatewayContactEmail: 'financeiro@horizonte.edu.br',
      gatewayContactPhone: '+5511999990001',
      legalEntityName: 'Colégio Horizonte LTDA',
      legalDocument: '12345678000190',
      bankInfoSummary: 'Banco 001, agência 1234, conta final 5678',
      defaultAmountCents: 35000,
      defaultDueDay: 10,
      lgpdAcceptedAt: daysAgo(60),
      platformTermsAcceptedAt: daysAgo(60),
      submittedAt: daysAgo(58),
      reviewedAt: daysAgo(55),
      reviewNotes: 'Cadastro aprovado para o ambiente de desenvolvimento.',
      asaasAccountId: 'seed_asaas_account_horizonte',
    },
  });

  // Mantém exemplos dos dois modos de gateway e de diferentes etapas de onboarding.
  await prisma.companyBillingSettings.upsert({
    where: { companyId: ids.companies.growth },
    update: {},
    create: {
      id: 'a0000000-0000-4000-8000-000000000002',
      companyId: ids.companies.growth,
      gatewayMode: BillingGatewayMode.EXTERNAL,
      onboardingStatus: BillingOnboardingStatus.UNDER_REVIEW,
      submittedAt: daysAgo(1),
    },
  });

  const templateRows = [
    [ids.templates.monthly, 'Mensalidade escolar', BillingTemplateRecurrence.MONTHLY, BillingTargetScope.STUDENTS, 35000, 10],
    [ids.templates.bimonthly, 'Atividades bimestrais', BillingTemplateRecurrence.BIMONTHLY, BillingTargetScope.STUDENTS, 12000, 15],
    [ids.templates.quarterly, 'Coordenação trimestral', BillingTemplateRecurrence.QUARTERLY, BillingTargetScope.COORDINATORS, 18000, 5],
    [ids.templates.semiannual, 'Material semestral', BillingTemplateRecurrence.SEMIANNUAL, BillingTargetScope.STUDENTS_AND_COORDINATORS, 45000, 20],
    [ids.templates.yearly, 'Matrícula anual', BillingTemplateRecurrence.YEARLY, BillingTargetScope.STUDENTS, 70000, 8],
  ] as const;

  for (const [id, name, recurrence, targetScope, amountCents, dueDay] of templateRows) {
    await prisma.billingTemplate.upsert({
      where: { id },
      update: { name, recurrence, targetScope, amountCents, dueDay },
      create: {
        id,
        companyId: company.id,
        name,
        description: `${name} - dados de desenvolvimento`,
        recurrence,
        targetScope,
        amountCents,
        dueDay,
        active: true,
        notifyOnGeneration: true,
      },
    });
  }

  const studentRows = [
    {
      id: ids.students.ana,
      name: 'Ana Souza',
      registration: '20260001',
      email: 'ana@horizonte.edu.br',
      phone: '+5511988880001',
      groupId: ids.groups.morning,
      billingTemplateId: ids.templates.monthly,
      active: true,
    },
    {
      id: ids.students.bruno,
      name: 'Bruno Oliveira',
      registration: '20260002',
      email: 'bruno@horizonte.edu.br',
      phone: '+5511988880002',
      groupId: ids.groups.morning,
      billingTemplateId: ids.templates.monthly,
      active: true,
    },
    {
      id: ids.students.carla,
      name: 'Carla Mendes',
      registration: '20260003',
      email: 'carla@horizonte.edu.br',
      phone: '+5511988880003',
      groupId: ids.groups.afternoon,
      billingTemplateId: ids.templates.yearly,
      active: false,
    },
  ];

  for (const student of studentRows) {
    await prisma.student.upsert({
      where: { id: student.id },
      update: student,
      create: { ...student, companyId: company.id },
    });
  }

  await prisma.user.upsert({
    where: { id: ids.users.student },
    update: { password, studentId: ids.students.ana, active: true },
    create: {
      id: ids.users.student,
      name: 'Ana Souza',
      email: 'ana.usuario@horizonte.edu.br',
      password,
      role: UserRole.USER,
      companyId: company.id,
      studentId: ids.students.ana,
      active: true,
    },
  });

  const busRows = [
    { id: ids.buses.one, plate: 'UNI1A01', capacity: 42 },
    { id: ids.buses.two, plate: 'UNI2B02', capacity: 28 },
  ];
  for (const bus of busRows) {
    await prisma.bus.upsert({
      where: { id: bus.id },
      update: bus,
      create: { ...bus, companyId: company.id },
    });
  }

  await prisma.device.upsert({
    where: { id: ids.devices.paired },
    update: { lastLat: -23.55052, lastLng: -46.633308, lastUpdate: now },
    create: {
      id: ids.devices.paired,
      hardwareId: 'UNIPASS-ESP32-SEED-001',
      code: 'DEV-SEED-001',
      secret: 'seed-device-secret-change-me',
      name: 'Leitor do ônibus UNI1A01',
      active: true,
      companyId: company.id,
      busId: ids.buses.one,
      pairedAt: daysAgo(45),
      lastLat: -23.55052,
      lastLng: -46.633308,
      lastUpdate: now,
    },
  });
  await prisma.device.upsert({
    where: { id: ids.devices.available },
    update: {},
    create: {
      id: ids.devices.available,
      hardwareId: 'UNIPASS-ESP32-SEED-002',
      pairingCode: '842731',
      pairingCodeExpiresAt: daysFromNow(7),
      name: 'Leitor aguardando pareamento',
      active: true,
    },
  });

  const cardRows = [
    { id: ids.cards.ana, tag: '04A1B2C3D4', studentId: ids.students.ana, active: true },
    { id: ids.cards.bruno, tag: '04B2C3D4E5', studentId: ids.students.bruno, active: true },
    { id: ids.cards.spare, tag: '04C3D4E5F6', studentId: null, active: false },
  ];
  for (const card of cardRows) {
    await prisma.rfidCard.upsert({
      where: { id: card.id },
      update: card,
      create: { ...card, companyId: company.id },
    });
  }

  const routeRows = [
    { id: ids.routes.school, name: 'Linha Centro → Escola', description: 'Rota de ida pelos bairros Centro e Jardim.' },
    { id: ids.routes.return, name: 'Linha Escola → Centro', description: 'Rota de retorno após as aulas.' },
  ];
  for (const route of routeRows) {
    await prisma.route.upsert({
      where: { id: route.id },
      update: route,
      create: { ...route, companyId: company.id, active: true },
    });
  }

  const scheduleRows = [
    {
      id: ids.schedules.go,
      routeId: ids.routes.school,
      busId: ids.buses.one,
      type: ScheduleType.GO,
      title: 'Ida - manhã',
      departureTime: new Date('1970-01-01T07:00:00.000Z'),
      departureMinutes: 420,
      dayOfWeeks: [1, 2, 3, 4, 5],
      notifyBeforeMinutes: 30,
      notificationTimeMinutes: 390,
      notificationDayOfWeeks: [1, 2, 3, 4, 5],
    },
    {
      id: ids.schedules.back,
      routeId: ids.routes.return,
      busId: ids.buses.one,
      type: ScheduleType.BACK,
      title: 'Volta - tarde',
      departureTime: new Date('1970-01-01T17:30:00.000Z'),
      departureMinutes: 1050,
      dayOfWeeks: [1, 2, 3, 4, 5],
      notifyBeforeMinutes: 45,
      notificationTimeMinutes: 1005,
      notificationDayOfWeeks: [1, 2, 3, 4, 5],
    },
    {
      id: ids.schedules.shift,
      routeId: ids.routes.school,
      busId: ids.buses.two,
      type: ScheduleType.SHIFT,
      title: 'Turno de sábado',
      departureTime: new Date('1970-01-01T08:00:00.000Z'),
      departureMinutes: 480,
      dayOfWeeks: [6],
      notifyBeforeMinutes: 60,
      notificationTimeMinutes: 420,
      notificationDayOfWeeks: [6],
    },
  ];
  for (const schedule of scheduleRows) {
    await prisma.routeSchedule.upsert({
      where: { id: schedule.id },
      update: schedule,
      create: { ...schedule, active: true },
    });
  }

  for (const [studentId, routeId] of [
    [ids.students.ana, ids.routes.school],
    [ids.students.ana, ids.routes.return],
    [ids.students.bruno, ids.routes.school],
  ] as const) {
    await prisma.studentRoute.upsert({
      where: { studentId_routeId: { studentId, routeId } },
      update: {},
      create: { studentId, routeId },
    });
  }

  const tripRows = [
    { id: ids.trips.active, status: TripStatus.ACTIVE, startedAt: daysAgo(0, 7), endedAt: null },
    { id: ids.trips.finished, status: TripStatus.FINISHED, startedAt: daysAgo(1, 7), endedAt: daysAgo(1, 8) },
    { id: ids.trips.cancelled, status: TripStatus.CANCELLED, startedAt: daysAgo(2, 17), endedAt: daysAgo(2, 17) },
  ];
  for (const trip of tripRows) {
    await prisma.trip.upsert({
      where: { id: trip.id },
      update: trip,
      create: { ...trip, busId: ids.buses.one, companyId: company.id },
    });
  }

  const eventRows = [
    ['b0000000-0000-4000-8000-000000000001', EventType.BOARDING, ids.students.ana, ids.cards.ana, daysAgo(1, 7)],
    ['b0000000-0000-4000-8000-000000000002', EventType.DEBOARDING, ids.students.ana, ids.cards.ana, daysAgo(1, 8)],
    ['b0000000-0000-4000-8000-000000000003', EventType.LEAVING, ids.students.bruno, ids.cards.bruno, daysAgo(0, 7)],
    ['b0000000-0000-4000-8000-000000000004', EventType.DENIED, null, ids.cards.spare, daysAgo(0, 7)],
  ] as const;
  for (const [id, type, studentId, rfidCardId, createdAt] of eventRows) {
    await prisma.transportEvent.upsert({
      where: { id },
      update: { type, createdAt },
      create: {
        id,
        type,
        studentId,
        rfidCardId,
        deviceId: ids.devices.paired,
        companyId: company.id,
        tripId: type === EventType.BOARDING || type === EventType.DEBOARDING ? ids.trips.finished : ids.trips.active,
        createdAt,
      },
    });
  }

  const occurrenceKey = daysFromNow(1).toISOString().slice(0, 10);
  await prisma.scheduleConfirmation.upsert({
    where: {
      userId_scheduleId_occurrenceKey: {
        userId: ids.users.student,
        scheduleId: ids.schedules.go,
        occurrenceKey,
      },
    },
    update: { willGo: true },
    create: {
      id: 'b1000000-0000-4000-8000-000000000001',
      userId: ids.users.student,
      scheduleId: ids.schedules.go,
      occurrenceKey,
      willGo: true,
    },
  });

  const promptRows = [
    ['b2000000-0000-4000-8000-000000000001', ids.schedules.go, occurrenceKey, NotificationChannel.IN_APP, NotificationPromptStatus.ANSWERED, true],
    ['b2000000-0000-4000-8000-000000000002', ids.schedules.back, `${occurrenceKey}-back`, NotificationChannel.PUSH, NotificationPromptStatus.DISPATCHED, null],
  ] as const;
  for (const [id, scheduleId, key, deliveryChannel, status, response] of promptRows) {
    await prisma.notificationPrompt.upsert({
      where: { id },
      update: { status, response },
      create: {
        id,
        userId: ids.users.student,
        scheduleId,
        occurrenceKey: key,
        message: 'Você utilizará o transporte neste horário?',
        deliveryChannel,
        status,
        response,
        dispatchedAt: now,
        answeredAt: status === NotificationPromptStatus.ANSWERED ? now : null,
      },
    });
  }

  const subscriptionRows = [
    ['b3000000-0000-4000-8000-000000000001', PushNotificationProvider.EXPO, PushPlatform.ANDROID, 'ExponentPushToken[seed-android]', 'seed-install-android'],
    ['b3000000-0000-4000-8000-000000000002', PushNotificationProvider.FCM, PushPlatform.WEB, 'seed-fcm-web-token', 'seed-install-web'],
    ['b3000000-0000-4000-8000-000000000003', PushNotificationProvider.APNS, PushPlatform.IOS, 'seed-apns-ios-token', 'seed-install-ios'],
  ] as const;
  for (const [id, provider, platform, token, installationKey] of subscriptionRows) {
    await prisma.pushSubscription.upsert({
      where: { id },
      update: { active: true, lastSeenAt: now },
      create: {
        id,
        userId: ids.users.student,
        provider,
        platform,
        token,
        installationKey,
        deviceName: `Dispositivo ${platform}`,
        appVersion: '1.0.0-dev',
        active: true,
        lastSeenAt: now,
      },
    });
  }

  const customerRows = [
    { id: ids.customers.ana, studentId: ids.students.ana, name: 'Responsável por Ana Souza', email: 'responsavel.ana@example.com', document: '12345678901', phone: '+5511977770001', asaasCustomerId: 'seed_customer_ana' },
    { id: ids.customers.bruno, studentId: ids.students.bruno, name: 'Responsável por Bruno Oliveira', email: 'responsavel.bruno@example.com', document: '23456789012', phone: '+5511977770002', asaasCustomerId: 'seed_customer_bruno' },
  ];
  for (const customer of customerRows) {
    await prisma.billingCustomer.upsert({
      where: { id: customer.id },
      update: customer,
      create: { ...customer, companyId: company.id },
    });
  }

  const chargeStatuses = Object.values(BillingChargeStatus);
  for (const [index, status] of chargeStatuses.entries()) {
    const id = `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const externalReference = `SEED-CHARGE-${status}`;
    const paid = status === BillingChargeStatus.PAID;
    await prisma.billingCharge.upsert({
      where: { id },
      update: { status, dueDate: daysFromNow(index - 3) },
      create: {
        id,
        companyId: company.id,
        templateId: ids.templates.monthly,
        ownerUserId: ids.users.admin,
        studentId: index % 2 === 0 ? ids.students.ana : ids.students.bruno,
        customerId: index % 2 === 0 ? ids.customers.ana : ids.customers.bruno,
        recipientName: index % 2 === 0 ? 'Responsável por Ana Souza' : 'Responsável por Bruno Oliveira',
        recipientEmail: index % 2 === 0 ? 'responsavel.ana@example.com' : 'responsavel.bruno@example.com',
        recipientDocument: index % 2 === 0 ? '12345678901' : '23456789012',
        description: `Mensalidade de desenvolvimento - ${status}`,
        amountCents: 35000 + index * 1000,
        issueDate: daysAgo(10),
        dueDate: daysFromNow(index - 3),
        status,
        gatewayChargeId: `seed_gateway_charge_${status.toLowerCase()}`,
        externalReference,
        bankSlipUrl: `https://example.test/boletos/${externalReference}`,
        gatewayInvoiceUrl: `https://example.test/faturas/${externalReference}`,
        gatewayStatus: status,
        gatewayStatusUpdatedAt: now,
        paidAt: paid ? daysAgo(1) : null,
        lastNotifiedAt: daysAgo(2),
      },
    });

    await prisma.billingEventLog.upsert({
      where: { deduplicationKey: `seed-event-${status.toLowerCase()}` },
      update: { processedAt: now },
      create: {
        id: `d0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        companyId: company.id,
        chargeId: id,
        customerId: index % 2 === 0 ? ids.customers.ana : ids.customers.bruno,
        eventType: `CHARGE_${status}`,
        source: [BillingEventSource.SYSTEM, BillingEventSource.WEBHOOK, BillingEventSource.MANUAL][index % 3],
        gatewayEvent: `PAYMENT_${status}`,
        deduplicationKey: `seed-event-${status.toLowerCase()}`,
        payload: { seed: true, status, amount: 35000 + index * 1000 },
        metadata: { environment: 'development', generatedBy: 'prisma/seed.ts' },
        processedAt: now,
      },
    });
  }

  console.log('✅ Seed concluído com sucesso.');
  console.log('🔐 Senha para todos os usuários: 123456');
  console.table([
    ...userRows.map(({ email, role }) => ({ email, perfil: role })),
    { email: 'ana.usuario@horizonte.edu.br', perfil: UserRole.USER },
  ]);
}

main()
  .catch((error: unknown) => {
    console.error('❌ Falha ao executar o seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
