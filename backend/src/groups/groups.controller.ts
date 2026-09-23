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
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { IdListDto } from 'src/common/dto/id-list.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { FindGroupsDto } from './dto/find-groups.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupsService } from './groups.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @Roles('ADMIN')
  create(@Req() req: any, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(req.user.companyId, dto);
  }

  @Get()
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  findAll(@Req() req: any, @Query() query: FindGroupsDto) {
    return this.groupsService.findAll({
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
    return this.groupsService.findOne(req.user.companyId, id);
  }

  @Patch('deactivate')
  @Roles('ADMIN')
  deactivateMany(@Req() req: any, @Body() dto: IdListDto) {
    return this.groupsService.deactivateMany(req.user.companyId, dto.ids);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(req.user.companyId, id, dto);
  }
}
