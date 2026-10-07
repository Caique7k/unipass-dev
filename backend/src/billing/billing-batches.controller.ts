import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingBatchesService } from './billing-batches.service';
import {
  CreateBillingBatchDto,
  FindBillingBatchesDto,
  PreviewBillingBatchDto,
} from './dto/billing-batch.dto';

type AuthenticatedRequest = Request & {
  user: { id: string; companyId: string | null; role: UserRole };
};

/** Emissão em massa (lotes). Só ADMIN; a empresa vem sempre do login. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('billing/batches')
export class BillingBatchesController {
  constructor(private readonly billingBatchesService: BillingBatchesService) {}

  @Post('preview')
  @HttpCode(200)
  preview(
    @Req() req: AuthenticatedRequest,
    @Body() dto: PreviewBillingBatchDto,
  ) {
    return this.billingBatchesService.preview(req.user.companyId, dto);
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBillingBatchDto) {
    return this.billingBatchesService.create(
      { id: req.user.id, companyId: req.user.companyId, ip: req.ip ?? null },
      dto,
    );
  }

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindBillingBatchesDto,
  ) {
    return this.billingBatchesService.list(
      req.user.companyId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Get(':id')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billingBatchesService.get(req.user.companyId, id);
  }
}
