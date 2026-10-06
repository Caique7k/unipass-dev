import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const billingGatewayOptions = ['EXTERNAL', 'ASAAS'] as const;

export class UpdateBillingGatewayDto {
  @IsIn(billingGatewayOptions)
  gateway: (typeof billingGatewayOptions)[number];
}

export class SaveAsaasCredentialsDto {
  @Transform(trimString)
  @IsString()
  @MinLength(20, { message: 'Cole a chave de API completa do Asaas.' })
  @MaxLength(512)
  apiKey: string;
}

/** Chave aleatória da URL do webhook de cada empresa (32 hex). */
export class AsaasWebhookParamsDto {
  @Matches(/^[a-f0-9]{32}$/)
  endpointKey: string;
}
