import { Controller, Post, Body, UseGuards, Get, Req } from '@nestjs/common';
import { TransportService } from './transport.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { BoardingDto } from './dto/boarding.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('transport')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  @Get('boarding-overview/today')
  getDailyBoardingOverview(@Req() req: any) {
    return this.transportService.getDailyBoardingOverview(req.user.companyId);
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
