import { ConfigService } from '@nestjs/config';

/**
 * Configuração global da API do Asaas. A URL e o ambiente valem para a
 * plataforma toda (sandbox em dev, produção em produção); a chave de API é de
 * cada empresa e fica cifrada no banco (CompanyBillingSettings).
 *
 * Sandbox:  ASAAS_ENV=sandbox     ASAAS_API_URL=https://api-sandbox.asaas.com/v3
 * Produção: ASAAS_ENV=production  ASAAS_API_URL=https://api.asaas.com/v3
 */
export type AsaasEnvironment = 'sandbox' | 'production';

// Prefixos oficiais das chaves (docs.asaas.com, "Autenticação"): uma chave de
// produção nunca autentica no sandbox e vice-versa.
export const ASAAS_KEY_PREFIX: Record<AsaasEnvironment, string> = {
  sandbox: '$aact_hmlg_',
  production: '$aact_prod_',
};

export const ASAAS_ENVIRONMENT_LABEL: Record<AsaasEnvironment, string> = {
  sandbox: 'Sandbox (testes)',
  production: 'Produção',
};

export class AsaasConfigurationError extends Error {}

export type AsaasConfig = {
  apiUrl: string;
  environment: AsaasEnvironment;
};

export function readAsaasConfig(configService: ConfigService): AsaasConfig {
  const environment = configService.get<string>('ASAAS_ENV')?.trim();
  const apiUrl = configService.get<string>('ASAAS_API_URL')?.trim();

  if (environment !== 'sandbox' && environment !== 'production') {
    throw new AsaasConfigurationError(
      'ASAAS_ENV precisa ser "sandbox" ou "production".',
    );
  }

  if (!apiUrl || !apiUrl.startsWith('https://')) {
    throw new AsaasConfigurationError(
      'ASAAS_API_URL precisa ser a URL https da API do Asaas.',
    );
  }

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    environment,
  };
}

/** Confere se a chave é do ambiente configurado, sem chamar o Asaas. */
export function keyMatchesEnvironment(
  apiKey: string,
  environment: AsaasEnvironment,
) {
  return apiKey.startsWith(ASAAS_KEY_PREFIX[environment]);
}
