import {
  Body,
  Controller,
  HttpCode,
  Get,
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
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingIssuanceService } from './billing-issuance.service';
import { BillingService } from './billing.service';
import { BillingWebhookService } from './billing-webhook.service';
import { FindBillingChargesDto } from './dto/find-billing-charges.dto';
import { IssueSingleChargeDto } from './dto/issue-single-charge.dto';
import { AsaasWebhookParamsDto } from './dto/billing-gateway.dto';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    companyId: string | null;
    role: UserRole;
  };
};

type BillingWebhookRequest = Request & {
  rawBody?: Buffer;
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly billingWebhookService: BillingWebhookService,
    private readonly billingIssuanceService: BillingIssuanceService,
  ) {}

  @Public()
  @HttpCode(200)
  @Post('webhook/asaas')
  handleAsaasWebhook(
    @Req() req: BillingWebhookRequest,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.billingWebhookService.handleAsaasWebhook({
      payload,
      headers: req.headers,
      rawBody: req.rawBody,
      remoteIp: req.ip ?? null,
    });
  }

  /** Webhook da conta Asaas de uma empresa (URL gerada em /billing/gateway). */
  @Public()
  @HttpCode(200)
  @Post('webhook/asaas/:endpointKey')
  handleCompanyAsaasWebhook(
    @Req() req: BillingWebhookRequest,
    @Param() params: AsaasWebhookParamsDto,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.billingWebhookService.handleCompanyAsaasWebhook({
      endpointKey: params.endpointKey,
      payload,
      headers: req.headers,
      rawBody: req.rawBody,
      remoteIp: req.ip ?? null,
    });
  }

  @Get('overview')
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR', 'USER')
  getOverview(@Req() req: AuthenticatedRequest) {
    return this.billingService.getOverview({
      companyId: req.user.companyId,
      userId: req.user.id,
      role: req.user.role,
    });
  }

  @Get('charges')
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR', 'USER')
  findCharges(
    @Req() req: AuthenticatedRequest,
    @Query() query: FindBillingChargesDto,
  ) {
    return this.billingService.findCharges({
      companyId: req.user.companyId,
      userId: req.user.id,
      role: req.user.role,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 10,
      search: query.search,
      templateId: query.templateId,
      month: query.month,
      status: query.status,
    });
  }

  /** Revisão antes de emitir: o que será cobrado e o que impede a emissão. */
  @Post('charges/preview')
  @HttpCode(200)
  @Roles('ADMIN')
  previewCharge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: IssueSingleChargeDto,
  ) {
    return this.billingIssuanceService.preview(req.user.companyId, dto);
  }

  /** Emite UMA cobrança (gateway próprio: só local; Asaas: envia ao Asaas). */
  @Post('charges')
  @Roles('ADMIN')
  issueCharge(
    @Req() req: AuthenticatedRequest,
    @Body() dto: IssueSingleChargeDto,
  ) {
    return this.billingIssuanceService.issue(
      { id: req.user.id, companyId: req.user.companyId, ip: req.ip ?? null },
      dto,
    );
  }

  @Get('charges/:id')
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR', 'USER')
  findCharge(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billingIssuanceService.getCharge(
      {
        companyId: req.user.companyId,
        userId: req.user.id,
        role: req.user.role,
      },
      id,
    );
  }

  @Post('charges/:id/retry')
  @HttpCode(200)
  @Roles('ADMIN')
  retryCharge(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billingIssuanceService.retry(
      { id: req.user.id, companyId: req.user.companyId, ip: req.ip ?? null },
      id,
    );
  }

  @Post('charges/:id/cancel')
  @HttpCode(200)
  @Roles('ADMIN')
  cancelCharge(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.billingIssuanceService.cancel(
      { id: req.user.id, companyId: req.user.companyId, ip: req.ip ?? null },
      id,
    );
  }
}
