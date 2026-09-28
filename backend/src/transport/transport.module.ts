import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { PrismaModule } from '../prisma/prisma.module';
import { IotTransportController } from './iot-transport.controller';
import { IotRfidController } from './iot-rfid.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TransportController, IotTransportController, IotRfidController],
  providers: [TransportService],
})
export class TransportModule {}
