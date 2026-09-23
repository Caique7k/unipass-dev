import { IsBooleanString, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class FindBillingTemplatesDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
