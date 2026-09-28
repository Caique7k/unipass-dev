import { BadRequestException } from '@nestjs/common';

// UID de TAG MIFARE/NTAG: 4, 7 ou 10 bytes em hex. Aceita um pouco de folga
// para leitores que devolvem o UID com byte de checagem.
const RFID_TAG_PATTERN = /^[0-9A-F]{8,20}$/;

/**
 * Formato canônico da TAG no banco: hex maiúsculo, sem separadores.
 * O firmware do UniHub imprime `AB:CD:EF:01`; leitores USB e digitação manual
 * podem trazer espaços ou hífens. Sem normalizar, a mesma TAG física não casa.
 */
export function normalizeRfidTag(raw: string | null | undefined) {
  if (typeof raw !== 'string') {
    return null;
  }

  const tag = raw.replace(/[\s:-]/g, '').toUpperCase();

  return RFID_TAG_PATTERN.test(tag) ? tag : null;
}

export function requireRfidTag(raw: string | null | undefined) {
  const tag = normalizeRfidTag(raw);

  if (!tag) {
    throw new BadRequestException(
      'Código da TAG inválido. Use o identificador hexadecimal lido pelo UniHub.',
    );
  }

  return tag;
}
