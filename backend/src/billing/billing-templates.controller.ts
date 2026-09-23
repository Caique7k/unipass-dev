import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { IdListDto } from 'src/common/dto/id-list.dto';
import { BillingTemplatesService } from './billing-templates.service';
import { CreateBillingTemplateDto } from './dto/create-billing-template.dto';
import { FindBillingTemplatesDto } from './dto/find-billing-templates.dto';
import { UpdateBillingTemplateDto } from './dto/update-billing-template.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing/templates')
export class BillingTemplatesController {
  constructor(
    private readonly billingTemplatesService: BillingTemplatesService,
  ) {}

  @Post()
  @Roles('ADMIN')
  create(@Req() req: any, @Body() dto: CreateBillingTemplateDto) {
    return this.billingTemplatesService.create(req.user.companyId, dto);
  }

  @Get()
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  findAll(@Req() req: any, @Query() query: FindBillingTemplatesDto) {
    return this.billingTemplatesService.findAll({
      companyId: req.user.companyId,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      search: query.search,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  findOne(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.billingTemplatesService.findOne(req.user.companyId, id);
  }

  @Patch('deactivate')
  @Roles('ADMIN')
  deactivateMany(@Req() req: any, @Body() body: IdListDto) {
    return this.billingTemplatesService.deactivateMany(
      req.user.companyId,
      body.ids,
    );
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBillingTemplateDto,
  ) {
    return this.billingTemplatesService.update(req.user.companyId, id, dto);
  }
}
