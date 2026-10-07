import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Teto por lote: acima disso, divida por grupo de boletos.
export const MAX_BATCH_STUDENTS = 2000;

/** Prévia da emissão em massa: grupo (vazio = todos) + mês + emissão. */
export class PreviewBillingBatchDto {
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @Transform(trimString)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Informe o mês de referência (AAAA-MM).',
  })
  referenceMonth: string;

  // Só vale no gateway próprio (agendamento); no Asaas a emissão é hoje.
  @IsOptional()
  @Transform(trimString)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Informe a data de emissão (AAAA-MM-DD).',
  })
  issueDate?: string;
}

/** Confirmação: os alunos marcados na prévia. */
export class CreateBillingBatchDto extends PreviewBillingBatchDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Marque pelo menos um aluno.' })
  @ArrayMaxSize(MAX_BATCH_STUDENTS, {
    message: `No máximo ${MAX_BATCH_STUDENTS} alunos por lote. Divida por grupo de boletos.`,
  })
  @IsUUID('all', { each: true })
  studentIds: string[];
}

export class FindBillingBatchesDto extends PaginationQueryDto {}
