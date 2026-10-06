import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BillingActor, BillingGatewayService } from './billing-gateway.service';
import {
  SaveAsaasCredentialsDto,
  UpdateBillingGatewayDto,
} from './dto/billing-gateway.dto';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string;
    companyId: string | null;
    role: UserRole;
  };
};

function toActor(req: AuthenticatedRequest): BillingActor {
  return {
    id: req.user.id,
    email: req.user.email,
    companyId: req.user.companyId,
    ip: req.ip ?? null,
  };
}

/**
 * Configuração do gateway de cobrança da empresa (gateway próprio ou Asaas).
 * Só ADMIN: a chave de API entra por aqui e nunca é devolvida.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('billing/gateway')
export class BillingGatewayController {
  constructor(private readonly billingGatewayService: BillingGatewayService) {}

  @Get()
  getGateway(@Req() req: AuthenticatedRequest) {
    return this.billingGatewayService.getGateway(req.user.companyId);
  }

  @Patch()
  setGateway(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateBillingGatewayDto,
  ) {
    return this.billingGatewayService.setGateway(toActor(req), dto.gateway);
  }

  @Put('asaas/credentials')
  saveCredentials(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SaveAsaasCredentialsDto,
  ) {
    return this.billingGatewayService.saveCredentials(toActor(req), dto.apiKey);
  }

  @Delete('asaas/credentials')
  removeCredentials(@Req() req: AuthenticatedRequest) {
    return this.billingGatewayService.removeCredentials(toActor(req));
  }

  @Post('asaas/test')
  @HttpCode(200)
  testConnection(@Req() req: AuthenticatedRequest) {
    return this.billingGatewayService.testConnection(toActor(req));
  }

  @Post('asaas/webhook')
  @HttpCode(200)
  configureWebhook(@Req() req: AuthenticatedRequest) {
    return this.billingGatewayService.configureWebhook(toActor(req));
  }
}
