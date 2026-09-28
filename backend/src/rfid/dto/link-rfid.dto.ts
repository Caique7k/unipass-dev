import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class LinkRfidDto {
  @IsString()
  studentId: string;

  @IsString()
  rfidTag: string;

  // true: as outras TAGs ativas do aluno são liberadas (cartão perdido/trocado).
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
