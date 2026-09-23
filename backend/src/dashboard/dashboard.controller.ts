import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetDashboardReportDto } from './dto/get-dashboard-report.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get()
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  async getDashboard(@Req() req: any) {
    const companyId = req.user.companyId;

    return this.dashboardService.getMetrics(companyId, req.user.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('reports')
  @Roles('ADMIN')
  async getReports(@Req() req: any, @Query() query: GetDashboardReportDto) {
    return this.dashboardService.getReport(req.user.companyId, query);
  }
}
