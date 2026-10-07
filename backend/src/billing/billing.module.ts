import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { AsaasClientFactory } from './asaas/asaas-client.factory';
import { BillingAuditService } from './billing-audit.service';
import { BillingBatchesController } from './billing-batches.controller';
import { BillingBatchesService } from './billing-batches.service';
import { BillingGatewayController } from './billing-gateway.controller';
import { BillingGatewayService } from './billing-gateway.service';
import { BillingIssuanceService } from './billing-issuance.service';
import { BillingTemplatesController } from './billing-templates.controller';
import { BillingTemplatesService } from './billing-templates.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingWebhookService } from './billing-webhook.service';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [
    BillingController,
    BillingTemplatesController,
    BillingGatewayController,
    BillingBatchesController,
  ],
  providers: [
    BillingService,
    BillingWebhookService,
    BillingTemplatesService,
    BillingGatewayService,
    BillingIssuanceService,
    BillingBatchesService,
    BillingAuditService,
    AsaasClientFactory,
  ],
  exports: [BillingWebhookService, BillingBatchesService],
})
export class BillingModule {}
