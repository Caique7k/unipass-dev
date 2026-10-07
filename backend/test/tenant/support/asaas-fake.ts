import { AsaasApiError } from 'src/billing/asaas/asaas-api.error';
import type {
  AsaasClient,
  AsaasCustomerInput,
  AsaasPaymentInput,
} from 'src/billing/asaas/asaas.client';
import type { AsaasClientFactory } from 'src/billing/asaas/asaas-client.factory';
import type { AsaasConfig } from 'src/billing/asaas/asaas.config';

export const TEST_ASAAS_CONFIG: AsaasConfig = {
  apiUrl: 'https://api-sandbox.asaas.com/v3',
  environment: 'sandbox',
};

type FakePayment = AsaasPaymentInput & { id: string; deleted: boolean };

/**
 * Asaas falso: nada sai para a rede. Guarda as chaves usadas (a empresa A
 * nunca pode usar a chave de B), os clientes e cobranças "criados" e cada
 * chamada feita, e deixa simular falhas:
 * - timeoutAfterCreatePayment: cria a cobrança e lança timeout (o pior caso:
 *   existe no Asaas, mas o UniPass não recebeu a resposta);
 * - failCreatePayment: recusa criar (erro de validação do Asaas);
 * - failPix: QR Code Pix indisponível.
 */
export function buildAsaasFake() {
  const keysUsed: string[] = [];
  const calls: string[] = [];
  const customers = new Map<string, AsaasCustomerInput & { id: string }>();
  const payments = new Map<string, FakePayment>();
  const failures = {
    timeoutAfterCreatePayment: false,
    failCreatePayment: false,
    failPix: false,
  };
  let sequence = 0;

  const client = (apiKey: string) =>
    ({
      getCommercialInfo: () => {
        calls.push('commercialInfo');
        return Promise.resolve({
          name: 'Conta de teste',
          companyName: null,
          cpfCnpj: '00000000000191',
          personType: 'JURIDICA',
          status: 'APPROVED',
        });
      },
      createWebhook: () => {
        calls.push('createWebhook');
        return Promise.resolve({ id: 'wh_test' });
      },
      updateWebhook: (id: string) => {
        calls.push('updateWebhook');
        return Promise.resolve({ id });
      },
      findCustomerByExternalReference: (externalReference: string) => {
        calls.push('findCustomer');
        const found = [...customers.values()].find(
          (customer) =>
            customer.externalReference === externalReference &&
            customer.id.startsWith(`cus_${apiKey.slice(-4)}`),
        );
        return Promise.resolve(found ? { id: found.id, deleted: false } : null);
      },
      createCustomer: (input: AsaasCustomerInput) => {
        calls.push('createCustomer');
        const id = `cus_${apiKey.slice(-4)}_${(sequence += 1)}`;
        customers.set(id, { ...input, id });
        return Promise.resolve({ id, deleted: false });
      },
      updateCustomer: (id: string, input: AsaasCustomerInput) => {
        calls.push('updateCustomer');
        if (!customers.has(id)) {
          return Promise.reject(
            new AsaasApiError('not_found', 'updateCustomer', 404),
          );
        }
        customers.set(id, { ...input, id });
        return Promise.resolve({ id, deleted: false });
      },
      findPaymentByExternalReference: (externalReference: string) => {
        calls.push('findPayment');
        const found = [...payments.values()].find(
          (payment) =>
            payment.externalReference === externalReference && !payment.deleted,
        );
        return Promise.resolve(found ? toPayment(found) : null);
      },
      createPayment: (input: AsaasPaymentInput) => {
        calls.push('createPayment');
        if (failures.failCreatePayment) {
          return Promise.reject(
            new AsaasApiError('validation', 'createPayment', 400, [
              {
                code: 'invalid_customer',
                description: 'Cliente inválido para esta cobrança.',
              },
            ]),
          );
        }
        const payment = {
          ...input,
          id: `pay_${(sequence += 1)}`,
          deleted: false,
        };
        payments.set(payment.id, payment);
        if (failures.timeoutAfterCreatePayment) {
          failures.timeoutAfterCreatePayment = false;
          return Promise.reject(
            new AsaasApiError('timeout', 'createPayment', null),
          );
        }
        return Promise.resolve(toPayment(payment));
      },
      getPayment: (id: string) => {
        calls.push('getPayment');
        const payment = payments.get(id);
        return payment
          ? Promise.resolve(toPayment(payment))
          : Promise.reject(new AsaasApiError('not_found', 'getPayment', 404));
      },
      getIdentificationField: (id: string) => {
        calls.push('identificationField');
        return Promise.resolve({
          identificationField: `23790.00009 ${id}`,
          nossoNumero: `NN-${id}`,
          barCode: `2379${id}`,
        });
      },
      getPixQrCode: (id: string) => {
        calls.push('pixQrCode');
        if (failures.failPix) {
          return Promise.reject(
            new AsaasApiError('not_found', 'pixQrCode', 404),
          );
        }
        return Promise.resolve({
          payload: `00020126PIX${id}`,
          expirationDate: '2027-12-31 23:59:59',
        });
      },
      deletePayment: (id: string) => {
        calls.push('deletePayment');
        const payment = payments.get(id);
        if (!payment) {
          return Promise.reject(
            new AsaasApiError('not_found', 'deletePayment', 404),
          );
        }
        payment.deleted = true;
        return Promise.resolve({ deleted: true });
      },
    }) as unknown as AsaasClient;

  const factory = {
    getConfig: () => TEST_ASAAS_CONFIG,
    create(apiKey: string) {
      keysUsed.push(apiKey);
      return client(apiKey);
    },
  } as unknown as AsaasClientFactory;

  return {
    factory,
    keysUsed,
    calls,
    customers,
    payments,
    failures,
    reset: () => {
      keysUsed.splice(0, keysUsed.length);
      calls.splice(0, calls.length);
      customers.clear();
      payments.clear();
      failures.timeoutAfterCreatePayment = false;
      failures.failCreatePayment = false;
      failures.failPix = false;
    },
  };
}

function toPayment(payment: FakePayment) {
  return {
    id: payment.id,
    status: 'PENDING',
    invoiceUrl: `https://sandbox.asaas.com/i/${payment.id}`,
    bankSlipUrl: `https://sandbox.asaas.com/b/pdf/${payment.id}`,
    nossoNumero: null,
    externalReference: payment.externalReference,
    deleted: payment.deleted,
  };
}
