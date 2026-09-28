import { IsUUID } from 'class-validator';

export class StartRfidCaptureDto {
  @IsUUID('4')
  deviceId: string;
}
