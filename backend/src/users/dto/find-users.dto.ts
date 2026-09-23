import { IsBooleanString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class FindUsersDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsBooleanString()
  active?: string;

  @IsOptional()
  @Transform(trimString)
  @IsIn(Object.values(UserRole))
  role?: string;
}
