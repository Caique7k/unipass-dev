import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsaasClient } from './asaas.client';
import { AsaasConfig, readAsaasConfig } from './asaas.config';

/** Cria o cliente do Asaas para a chave de uma empresa (troca nos testes). */
@Injectable()
export class AsaasClientFactory {
  constructor(private readonly configService: ConfigService) {}

  /** Lança AsaasConfigurationError se ASAAS_ENV/ASAAS_API_URL estiverem errados. */
  getConfig(): AsaasConfig {
    return readAsaasConfig(this.configService);
  }

  create(apiKey: string): AsaasClient {
    return new AsaasClient(this.getConfig(), apiKey);
  }
}
