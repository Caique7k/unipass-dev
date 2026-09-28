import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InternalApiKeyGuard } from 'src/auth/internal-api-key.guard';
import { Public } from 'src/auth/public.decorator';
import { TransportService } from './transport.service';
import { IotBoardingDto } from './dto/iot-boarding.dto';

// Endpoint único de leitura do UniHub: o firmware não sabe se é embarque,
// desembarque ou cadastro de TAG — quem decide é o TransportService.
@Public()
@UseGuards(InternalApiKeyGuard)
@Controller('iot/rfid')
@Throttle({
  default: {
    limit: 1200,
    ttl: 60_000,
  },
})
export class IotRfidController {
  constructor(private readonly transportService: TransportService) {}

  @Post('read')
  @HttpCode(200)
  read(@Body() dto: IotBoardingDto) {
    return this.transportService.handleIotRead(dto);
  }
}
