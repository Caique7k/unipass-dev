import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingChargeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { hashSecret } from './billing-crypto.util';
import { BillingWebhookService } from './billing-webhook.service';

const ENDPOINT_KEY = 'a'.repeat(32);
const COMPANY_TOKEN = 'b'.repeat(48);
const PAYLOAD = {
  id: 'evt_1',
  event: 'PAYMENT_RECEIVED',
  payment: { id: 'pay_1', status: 'RECEIVED' },
};

function buildService(env: Record<string, string> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    companyBillingSettings: {
      findUnique: jest.fn(
        ({ where }: { where: { asaasWebhookEndpointKey?: string } }) =>
          Promise.resolve(
            where.asaasWebhookEndpointKey === ENDPOINT_KEY
              ? {
                  companyId: 'company-1',
                  asaasWebhookTokenHash: hashSecret(COMPANY_TOKEN),
                }
              : null,
          ),
      ),
    },
    billingEventLog: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({
          id: 'log-1',
          companyId: data.companyId ?? null,
          chargeId: null,
          processedAt: null,
        });
      }),
    },
  };
  const queue = { addBillingWebhookJob: jest.fn(() => Promise.resolve()) };
  const service = new BillingWebhookService(
    prisma as unknown as PrismaService,
    new ConfigService(env),
    queue as unknown as QueueService,
  );

  return { service, created, queue };
}

describe('BillingWebhookService — segurança', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('rota legada (POST /billing/webhook/asaas)', () => {
    it('sem ASAAS_WEBHOOK_TOKEN configurado recusa tudo (antes aceitava)', async () => {
      const { service, created } = buildService();

      await expect(
        service.handleAsaasWebhook({ payload: PAYLOAD, headers: {} }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(created).toEqual([]);
    });

    it('token errado ou ausente: 401', async () => {
      const { service } = buildService({ ASAAS_WEBHOOK_TOKEN: 'certo' });

      await expect(
        service.handleAsaasWebhook({
          payload: PAYLOAD,
          headers: { 'asaas-access-token': 'errado' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        service.handleAsaasWebhook({ payload: PAYLOAD, headers: {} }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('token certo: grava, enfileira e responde sem ids internos', async () => {
      const { service, created, queue } = buildService({
        ASAAS_WEBHOOK_TOKEN: 'certo',
      });

      const response = await service.handleAsaasWebhook({
        payload: PAYLOAD,
        headers: { 'asaas-access-token': 'certo' },
      });

      expect(response).toEqual({
        received: true,
        duplicate: false,
        queued: true,
      });
      expect(created).toHaveLength(1);
      expect(queue.addBillingWebhookJob).toHaveBeenCalled();
    });

    it('a allowlist de IP usa o IP da conexão, não headers que o cliente envia', async () => {
      const { service } = buildService({
        ASAAS_WEBHOOK_TOKEN: 'certo',
        ASAAS_WEBHOOK_IP_WHITELIST: '52.67.12.206',
      });

      await expect(
        service.handleAsaasWebhook({
          payload: PAYLOAD,
          headers: {
            'asaas-access-token': 'certo',
            'x-real-ip': '52.67.12.206',
            'x-forwarded-for': '52.67.12.206',
          },
          remoteIp: '203.0.113.9',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        service.handleAsaasWebhook({
          payload: PAYLOAD,
          headers: { 'asaas-access-token': 'certo' },
          remoteIp: '::ffff:52.67.12.206',
        }),
      ).resolves.toMatchObject({ received: true });
    });
  });

  describe('rota por empresa (POST /billing/webhook/asaas/:endpointKey)', () => {
    it('chave de URL desconhecida ou token errado: o mesmo 401', async () => {
      const { service, created } = buildService();

      for (const [endpointKey, token] of [
        ['c'.repeat(32), COMPANY_TOKEN],
        [ENDPOINT_KEY, 'token-errado'],
        [ENDPOINT_KEY, ''],
      ]) {
        await expect(
          service.handleCompanyAsaasWebhook({
            endpointKey,
            payload: PAYLOAD,
            headers: { 'asaas-access-token': token },
          }),
        ).rejects.toThrow('Invalid Asaas webhook token');
      }
      expect(created).toEqual([]);
    });

    it('token certo: o evento nasce na empresa da URL, com dedupe por empresa', async () => {
      const { service, created } = buildService();

      await service.handleCompanyAsaasWebhook({
        endpointKey: ENDPOINT_KEY,
        payload: PAYLOAD,
        headers: { 'asaas-access-token': COMPANY_TOKEN },
      });

      expect(created[0]).toMatchObject({
        companyId: 'company-1',
        deduplicationKey: 'asaas:company-1:event:evt_1',
      });
    });
  });
});

describe('BillingWebhookService — status', () => {
  const { service } = buildService();
  // Método privado: é a regra de negócio "evento do Asaas -> status".
  const plan = (
    event: string,
    paymentStatus: string,
    current: BillingChargeStatus,
  ) =>
    (
      service as unknown as {
        buildChargeUpdateFromAsaasWebhook: (params: unknown) => {
          updateData: { status?: BillingChargeStatus };
        };
      }
    ).buildChargeUpdateFromAsaasWebhook({
      charge: {
        customerId: null,
        gatewayChargeId: 'pay_1',
        externalReference: null,
        gatewayStatus: null,
        gatewayInvoiceUrl: null,
        bankSlipUrl: null,
        status: current,
        paidAt: null,
        gatewayStatusUpdatedAt: null,
      },
      payment: { id: 'pay_1', status: paymentStatus },
      event,
      webhookCreatedAt: null,
    }).updateData.status;

  it('visualizar o boleto depois de pago não volta para "emitido"', () => {
    expect(
      plan('PAYMENT_BANK_SLIP_VIEWED', 'RECEIVED', BillingChargeStatus.PAID),
    ).toBeUndefined();
    expect(
      plan('PAYMENT_CHECKOUT_VIEWED', 'RECEIVED', BillingChargeStatus.PAID),
    ).toBeUndefined();
  });

  it('estorno vira REFUNDED, não CANCELLED', () => {
    expect(plan('PAYMENT_REFUNDED', 'REFUNDED', BillingChargeStatus.PAID)).toBe(
      BillingChargeStatus.REFUNDED,
    );
  });

  it('estorno parcial não muda o status sozinho', () => {
    expect(
      plan('PAYMENT_PARTIALLY_REFUNDED', 'RECEIVED', BillingChargeStatus.PAID),
    ).toBeUndefined();
  });

  it('negativação recebida é pagamento', () => {
    expect(
      plan(
        'PAYMENT_DUNNING_RECEIVED',
        'DUNNING_RECEIVED',
        BillingChargeStatus.OVERDUE,
      ),
    ).toBe(BillingChargeStatus.PAID);
  });

  it('desfazer recebimento em dinheiro volta a cobrança para emitida', () => {
    expect(
      plan(
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        'PENDING',
        BillingChargeStatus.PAID,
      ),
    ).toBe(BillingChargeStatus.ISSUED);
  });

  it('alteração de valor/vencimento segue o status do pagamento', () => {
    expect(plan('PAYMENT_UPDATED', 'OVERDUE', BillingChargeStatus.ISSUED)).toBe(
      BillingChargeStatus.OVERDUE,
    );
  });

  it('pagamento recebido e cobrança apagada continuam como antes', () => {
    expect(
      plan('PAYMENT_RECEIVED', 'RECEIVED', BillingChargeStatus.ISSUED),
    ).toBe(BillingChargeStatus.PAID);
    expect(plan('PAYMENT_DELETED', 'DELETED', BillingChargeStatus.ISSUED)).toBe(
      BillingChargeStatus.CANCELLED,
    );
  });
});
