import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Delete,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RfidService } from './rfid.service';
import { LinkRfidDto } from './dto/link-rfid.dto';
import { StartRfidCaptureDto } from './dto/start-rfid-capture.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/roles.guard';

type AuthRequest = { user: { id: string; companyId: string | null } };

// Vincular ou trocar a TAG: ADMIN e DRIVER (o motorista pode fazer em campo).
// Captura pelo leitor: só ADMIN.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rfid')
export class RfidController {
  constructor(private readonly rfidService: RfidService) {}

  @Post('link')
  @Roles('ADMIN', 'DRIVER')
  link(@Body() dto: LinkRfidDto, @Req() req: any) {
    const companyId = req.user.companyId;

    return this.rfidService.link(companyId, dto);
  }

  @Post('capture')
  @Roles('ADMIN')
  startCapture(@Body() dto: StartRfidCaptureDto, @Req() req: AuthRequest) {
    return this.rfidService.startCapture(req.user, dto);
  }

  @Get('capture/:id')
  @Roles('ADMIN')
  getCapture(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.rfidService.getCapture(req.user, id);
  }

  @Delete('capture/:id')
  @Roles('ADMIN')
  cancelCapture(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.rfidService.cancelCapture(req.user, id);
  }
}
