import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import Redis from 'ioredis';
import { getRedisOptions } from './redis.util';
import {
  BILLING_ISSUE_QUEUE,
  BILLING_WEBHOOK_QUEUE,
  ISSUE_BILLING_CHARGE_JOB,
  NOTIFICATIONS_QUEUE,
  PROCESS_BILLING_WEBHOOK_JOB,
  SEND_NOTIFICATION_JOB,
} from './queue.constants';

export const BILLING_ISSUE_ATTEMPTS = 5;

@Injectable()
export class QueueService implements OnModuleDestroy {
  private connection: Redis;
  private notificationQueue: Queue;
  private billingWebhookQueue: Queue;
  private billingIssueQueue: Queue;

  constructor(private readonly configService: ConfigService) {
    this.connection = new Redis(getRedisOptions(configService));

    this.notificationQueue = new Queue(NOTIFICATIONS_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    this.billingWebhookQueue = new Queue(BILLING_WEBHOOK_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    // Emissão em massa no Asaas: um job por cobrança. Falha passageira
    // (429, 5xx, timeout) volta para a fila com espera crescente; a última
    // tentativa marca a cobrança como FAILED (billing-issue-worker).
    this.billingIssueQueue = new Queue(BILLING_ISSUE_QUEUE, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: BILLING_ISSUE_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: 15_000,
        },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  async addNotificationJob(
    data: { promptId: string },
    options?: Pick<JobsOptions, 'jobId' | 'delay'>,
  ) {
    await this.notificationQueue.add(SEND_NOTIFICATION_JOB, data, options);
  }

  async addBillingWebhookJob(
    data: { eventLogId: string },
    options?: Pick<JobsOptions, 'jobId' | 'delay'>,
  ) {
    await this.billingWebhookQueue.add(
      PROCESS_BILLING_WEBHOOK_JOB,
      data,
      options,
    );
  }

  async addBillingIssueJob(data: { chargeId: string }) {
    await this.billingIssueQueue.add(ISSUE_BILLING_CHARGE_JOB, data, {
      // Mesmo id para a mesma cobrança: reenfileirar não duplica o job.
      jobId: `billing-issue-${data.chargeId}`,
    });
  }

  async onModuleDestroy() {
    await this.billingIssueQueue.close();
    await this.billingWebhookQueue.close();
    await this.notificationQueue.close();
    await this.connection.quit();
  }
}
