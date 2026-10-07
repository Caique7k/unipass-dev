import { ConfigService } from '@nestjs/config';
import { BillingAuditService } from 'src/billing/billing-audit.service';
import { BillingGatewayService } from 'src/billing/billing-gateway.service';
import { BillingIssuanceService } from 'src/billing/billing-issuance.service';
import { BillingTemplatesService } from 'src/billing/billing-templates.service';
import { BillingWebhookService } from 'src/billing/billing-webhook.service';
import { BillingService } from 'src/billing/billing.service';
import { DashboardService } from 'src/dashboard/dashboard.service';
import { DevicesService } from 'src/devices/devices.service';
import { LocationService } from 'src/location/location.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { QueueService } from 'src/queue/queue.service';
import { RfidService } from 'src/rfid/rfid.service';
import { StudentsService } from 'src/students/students.service';
import { TransportService } from 'src/transport/transport.service';
import { UsersService } from 'src/users/users.service';
import { buildAsaasFake } from './asaas-fake';
import { TEST_BILLING_KEY_BASE64 } from './billing-test-key';

/**
 * Os services reais, com o Prisma do banco de teste (sem TestingModule).
 * Cada módulo coberto pelos testes de isolamento entra aqui.
 */
export function buildServices(prisma: PrismaService) {
  const config = new ConfigService();
  // Chave mestra só deste processo de teste; o Asaas é falso (asaas-fake.ts).
  const billingConfig = new ConfigService({
    BILLING_ENCRYPTION_KEY: TEST_BILLING_KEY_BASE64,
  });
  const asaas = buildAsaasFake();
  const billingAudit = new BillingAuditService(prisma);
  const billingGateway = new BillingGatewayService(
    prisma,
    billingConfig,
    asaas.factory,
    billingAudit,
  );
  // O BillingService só usa o webhook para montar a referência externa do
  // boleto; a fila (Redis) nunca é chamada nesses fluxos. Se for, o teste
  // quebra na hora em vez de passar escondido.
  const billingWebhook = new BillingWebhookService(
    prisma,
    config,
    {} as QueueService,
  );

  return {
    students: new StudentsService(prisma, billingConfig),
    users: new UsersService(prisma),
    billing: new BillingService(prisma, billingWebhook, billingConfig),
    billingTemplates: new BillingTemplatesService(prisma),
    billingGateway,
    billingIssuance: new BillingIssuanceService(
      prisma,
      billingConfig,
      billingGateway,
      billingAudit,
      billingWebhook,
    ),
    // Webhook com fila falsa: os testes chamam o processamento direto.
    billingWebhookReceiver: new BillingWebhookService(prisma, config, {
      addBillingWebhookJob: () => Promise.resolve(),
    } as unknown as QueueService),
    asaas,
    rfid: new RfidService(prisma),
    transport: new TransportService(prisma, config),
    devices: new DevicesService(prisma),
    location: new LocationService(prisma),
    dashboard: new DashboardService(prisma, config),
  };
}

export type TenantServices = ReturnType<typeof buildServices>;
