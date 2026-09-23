import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  Req,
  Query,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { FindStudentsDto } from './dto/find-students.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { IdListDto } from 'src/common/dto/id-list.dto';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Get()
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  findAll(@Req() req: any, @Query() query: FindStudentsDto) {
    return this.studentsService.findAll({
      companyId: req.user.companyId,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      search: query.search,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
  }

  @Get('user-candidates/list')
  @Roles('ADMIN')
  findUserCandidates(
    @Req() req: any,
    @Query('includeUserId') includeUserId?: string,
  ) {
    return this.studentsService.findUserCandidates(
      req.user.companyId,
      includeUserId,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'DRIVER', 'COORDINATOR')
  findOne(@Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.studentsService.findOne(req.user.companyId, id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Req() req: any, @Body() dto: CreateStudentDto) {
    return this.studentsService.create(req.user.companyId, dto);
  }

  @Put(':id')
  @Roles('ADMIN')
  update(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.studentsService.update(req.user.companyId, id, dto);
  }

  @Delete()
  @Roles('ADMIN')
  deleteMany(@Req() req: any, @Body() dto: IdListDto) {
    return this.studentsService.deleteMany(req.user.companyId, dto.ids);
  }

  @Patch('desactivate')
  @Roles('ADMIN')
  desactivateMany(@Req() req: any, @Body() dto: IdListDto) {
    return this.studentsService.desactivateMany(req.user.companyId, dto.ids);
  }
}
