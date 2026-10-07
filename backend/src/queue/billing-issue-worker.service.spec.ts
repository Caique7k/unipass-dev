import { ConfigService } from '@nestjs/config';
import type { BillingBatchesService } from 'src/billing/billing-batches.service';
import {
  BillingIssueWorkerService,
  RetryBillingIssueLater,
} from './billing-issue-worker.service';
import { ISSUE_BILLING_CHARGE_JOB } from './queue.constants';

type Outcome = 'ISSUED' | 'FAILED' | 'RETRY' | 'DONE';

function buildWorker(outcome: Outcome) {
  const processCharge = jest.fn(() => Promise.resolve({ outcome }));
  const worker = new BillingIssueWorkerService(new ConfigService(), {
    processCharge,
  } as unknown as BillingBatchesService);
  return { worker, processCharge };
}

const job = (attemptsMade: number) => ({
  name: ISSUE_BILLING_CHARGE_JOB,
  data: { chargeId: 'charge-1' },
  attemptsMade,
  opts: { attempts: 5 },
});

/** O worker só decide "tentar de novo ou não"; a emissão é do service. */
describe('BillingIssueWorkerService', () => {
  it('falha passageira antes da última tentativa: relança para a fila repetir', async () => {
    const { worker, processCharge } = buildWorker('RETRY');

    await expect(worker.handle(job(0))).rejects.toBeInstanceOf(
      RetryBillingIssueLater,
    );
    expect(processCharge).toHaveBeenCalledWith('charge-1', {
      finalAttempt: false,
    });
  });

  it('a 5ª tentativa é a última: o service marca a cobrança como erro', async () => {
    const { worker, processCharge } = buildWorker('FAILED');

    await expect(worker.handle(job(4))).resolves.toBeUndefined();
    expect(processCharge).toHaveBeenCalledWith('charge-1', {
      finalAttempt: true,
    });
  });

  it.each<Outcome>(['ISSUED', 'FAILED', 'DONE'])(
    'resultado %s termina o job sem relançar',
    async (outcome) => {
      const { worker } = buildWorker(outcome);

      await expect(worker.handle(job(1))).resolves.toBeUndefined();
    },
  );

  it('ignora jobs de outro tipo', async () => {
    const { worker, processCharge } = buildWorker('ISSUED');

    await worker.handle({ ...job(0), name: 'outro-job' });

    expect(processCharge).not.toHaveBeenCalled();
  });
});
