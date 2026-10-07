import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Emissão de UMA cobrança (prévia e emissão usam o mesmo corpo). Valor e
 * vencimento são opcionais: sem eles, valem os do grupo de boletos.
 */
export class IssueSingleChargeDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  templateId: string;

  @Transform(trimString)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Informe o mês de referência (AAAA-MM).',
  })
  referenceMonth: string;

  @IsOptional()
  @IsInt({ message: 'Informe o valor em centavos.' })
  @Min(1, { message: 'O valor precisa ser maior que zero.' })
  @Max(100_000_000)
  amountCents?: number;

  @IsOptional()
  @Transform(trimString)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Informe o vencimento (AAAA-MM-DD).',
  })
  dueDate?: string;

  // O Asaas aceita até 500 caracteres na descrição da cobrança.
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  description?: string;
}
