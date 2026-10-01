import { ConfigService } from '@nestjs/config';
import { BillingTemplatesService } from 'src/billing/billing-templates.service';
import { BillingWebhookService } from 'src/billing/billing-webhook.service';
import { BillingService } from 'src/billing/billing.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { QueueService } from 'src/queue/queue.service';
import { StudentsService } from 'src/students/students.service';
import { UsersService } from 'src/users/users.service';

/**
 * Os services reais, com o Prisma do banco de teste (sem TestingModule).
 * Cada módulo coberto pelos testes de isolamento entra aqui.
 */
export function buildServices(prisma: PrismaService) {
  const config = new ConfigService();
  // O BillingService só usa o webhook para montar a referência externa do
  // boleto; a fila (Redis) nunca é chamada nesses fluxos. Se for, o teste
  // quebra na hora em vez de passar escondido.
  const billingWebhook = new BillingWebhookService(
    prisma,
    config,
    {} as QueueService,
  );

  return {
    students: new StudentsService(prisma),
    users: new UsersService(prisma),
    billing: new BillingService(prisma, billingWebhook),
    billingTemplates: new BillingTemplatesService(prisma),
  };
}

export type TenantServices = ReturnType<typeof buildServices>;
