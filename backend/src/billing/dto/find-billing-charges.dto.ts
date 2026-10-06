import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const billingChargeStatusFilters = [
  'ALL',
  'OPEN',
  'PAID',
  'OVERDUE',
  'SCHEDULED',
  'ISSUED',
  'SENT',
  'DRAFT',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
] as const;

export type BillingChargeStatusFilter =
  (typeof billingChargeStatusFilters)[number];

export class FindBillingChargesDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  page?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  limit?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  templateId?: string;

  @IsOptional()
  @Transform(trimString)
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @Transform(trimString)
  @IsIn(billingChargeStatusFilters)
  status?: BillingChargeStatusFilter;
}
