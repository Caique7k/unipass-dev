import { BadRequestException } from '@nestjs/common';
import { normalizeRfidTag, requireRfidTag } from './rfid-tag.util';

describe('normalizeRfidTag', () => {
  it('converte o formato do Serial do UniHub para o canônico', () => {
    expect(normalizeRfidTag('04:a1:b2:c3:d4')).toBe('04A1B2C3D4');
  });

  it('aceita espaços e hífens', () => {
    expect(normalizeRfidTag(' 04 A1-B2 C3 D4 ')).toBe('04A1B2C3D4');
  });

  it('mantém o formato já canônico do banco', () => {
    expect(normalizeRfidTag('04A1B2C3D4')).toBe('04A1B2C3D4');
  });

  it.each(['', 'ABC', 'XYZ12345', '04A1B2C3D4E5F6A7B8C9D0', undefined, null])(
    'recusa %p',
    (value) => {
      expect(normalizeRfidTag(value)).toBeNull();
    },
  );

  it('requireRfidTag lança 400 para TAG inválida', () => {
    expect(() => requireRfidTag('nope')).toThrow(BadRequestException);
  });
});
