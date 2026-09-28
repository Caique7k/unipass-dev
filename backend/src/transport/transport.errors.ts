import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type TransportDenialReason =
  | 'UNKNOWN_TAG'
  | 'OTHER_COMPANY'
  | 'INACTIVE_TAG'
  | 'INACTIVE_STUDENT';

export type TransportStateReason = 'ALREADY_ON_BOARD' | 'NOT_ON_BOARD';

// Mesma resposta HTTP de antes (403/400 com a mensagem), mas com um código
// estável para o fluxo do UniHub não depender do texto em português.
export class TransportDeniedException extends ForbiddenException {
  constructor(
    message: string,
    readonly reason: TransportDenialReason,
  ) {
    super(message);
  }
}

export class TransportStateException extends BadRequestException {
  constructor(
    message: string,
    readonly reason: TransportStateReason,
  ) {
    super(message);
  }
}
