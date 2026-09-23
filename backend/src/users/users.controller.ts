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
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IdListDto } from 'src/common/dto/id-list.dto';
import { UsersService } from './users.service';
import { FindUsersDto } from './dto/find-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMIN')
  findAll(@Req() req: any, @Query() query: FindUsersDto) {
    return this.usersService.findAll(req.user, {
      search: query.search,
      active: query.active === undefined ? undefined : query.active === 'true',
      role: query.role,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });
  }

  @Post()
  @Roles('ADMIN')
  create(@Req() req: any, @Body() dto: CreateUserDto) {
    return this.usersService.create(req.user, dto);
  }

  @Patch('deactivate')
  @Roles('ADMIN')
  deactivateMany(@Req() req: any, @Body() dto: IdListDto) {
    return this.usersService.deactivateMany(req.user, dto.ids);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(req.user, id, dto);
  }
}
