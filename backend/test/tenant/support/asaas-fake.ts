import type { AsaasClient } from 'src/billing/asaas/asaas.client';
import type { AsaasClientFactory } from 'src/billing/asaas/asaas-client.factory';
import type { AsaasConfig } from 'src/billing/asaas/asaas.config';

export const TEST_ASAAS_CONFIG: AsaasConfig = {
  apiUrl: 'https://api-sandbox.asaas.com/v3',
  environment: 'sandbox',
};

/**
 * Asaas falso: nada sai para a rede. Guarda com qual chave cada cliente foi
 * criado, para provar que a empresa A nunca usa a chave da empresa B.
 */
export function buildAsaasFake() {
  const keysUsed: string[] = [];

  const factory = {
    getConfig: () => TEST_ASAAS_CONFIG,
    create(apiKey: string) {
      keysUsed.push(apiKey);

      return {
        getCommercialInfo: () =>
          Promise.resolve({
            name: 'Conta de teste',
            companyName: null,
            cpfCnpj: '00000000000191',
            personType: 'JURIDICA',
            status: 'APPROVED',
          }),
        createWebhook: () => Promise.resolve({ id: 'wh_test' }),
        updateWebhook: (id: string) => Promise.resolve({ id }),
      } as unknown as AsaasClient;
    },
  } as unknown as AsaasClientFactory;

  return {
    factory,
    keysUsed,
    reset: () => keysUsed.splice(0, keysUsed.length),
  };
}
