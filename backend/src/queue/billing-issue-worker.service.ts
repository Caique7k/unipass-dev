import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';
import { BillingBatchesService } from 'src/billing/billing-batches.service';
import {
  BILLING_ISSUE_QUEUE,
  ISSUE_BILLING_CHARGE_JOB,
} from './queue.constants';
import { BILLING_ISSUE_ATTEMPTS } from './queue.service';
import { getRedisOptions } from './redis.util';

export class RetryBillingIssueLater extends Error {
  constructor(chargeId: string) {
    super(`Cobrança ${chargeId}: falha temporária no Asaas, nova tentativa.`);
    this.name = 'RetryBillingIssueLater';
  }
}

/**
 * Processa a fila "billing-issue": uma cobrança do lote por job, enviada ao
 * Asaas pelo BillingBatchesService. Concorrência baixa e limite de jobs por
 * segundo para respeitar os limites da API do Asaas; falha passageira volta
 * para a fila (backoff do QueueService) e a última tentativa marca FAILED.
 */
@Injectable()
export class BillingIssueWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BillingIssueWorkerService.name);
  private worker?: Worker;

  constructor(
    private readonly configService: ConfigService,
    private readonly billingBatchesService: BillingBatchesService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      BILLING_ISSUE_QUEUE,
      (job: Job<{ chargeId: string }>) => this.handle(job),
      {
        connection: {
          ...getRedisOptions(this.configService),
          maxRetriesPerRequest: null,
        },
        concurrency: Number(
          this.configService.get<string>('BILLING_ISSUE_WORKER_CONCURRENCY') ??
            '2',
        ),
        limiter: { max: 5, duration: 1000 },
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.warn(`Job ${job?.id} falhou: ${error?.message}`);
    });
  }

  async handle(
    job: Pick<
      Job<{ chargeId: string }>,
      'name' | 'data' | 'attemptsMade' | 'opts'
    >,
  ) {
    if (job.name !== ISSUE_BILLING_CHARGE_JOB) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? BILLING_ISSUE_ATTEMPTS;
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
    const { outcome } = await this.billingBatchesService.processCharge(
      job.data.chargeId,
      { finalAttempt },
    );

    if (outcome === 'RETRY') {
      // Lançar faz o BullMQ tentar de novo com espera crescente.
      throw new RetryBillingIssueLater(job.data.chargeId);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
