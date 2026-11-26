import { Controller, Post, Body, UseGuards, Get, Req } from '@nestjs/common';
import { TransportService } from './transport.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { BoardingDto } from './dto/boarding.dto';

type LoggedRequest = { user: { id: string; companyId: string | null } };

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('transport')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  @Get('boarding-overview/today')
  getDailyBoardingOverview(@Req() req: any) {
    return this.transportService.getDailyBoardingOverview(req.user.companyId);
  }

  // O aluno vem do login: a rota não recebe nenhum id.
  @Roles('USER')
  @Get('me/today')
  getMyTripToday(@Req() req: LoggedRequest) {
    return this.transportService.getMyTripToday(
      req.user.id,
      req.user.companyId,
    );
  }

  @Roles('DRIVER', 'ADMIN')
  @Post('boarding')
  /*  */
  register(@Req() req: any, @Body() dto: BoardingDto) {
    return this.transportService.registerBoarding(req.user.companyId, dto);
  }
  @Roles('DRIVER', 'ADMIN')
  @Post('deboarding')
  async registerDeboarding(@Req() req: any, @Body() dto: BoardingDto) {
    return this.transportService.registerDeboarding(req.user.companyId, dto);
  }
}
