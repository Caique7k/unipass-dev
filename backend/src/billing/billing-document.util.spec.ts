import { randomBytes } from 'node:crypto';
import { decryptSecret } from './billing-crypto.util';
import {
  InvalidDocumentError,
  hashDocument,
  isValidCnpj,
  isValidCpf,
  looksLikeDocument,
  normalizeCpfCnpj,
  protectDocument,
} from './billing-document.util';

describe('billing-document.util', () => {
  const key = randomBytes(32);

  it('valida CPF pelos dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
  });

  it('valida CNPJ pelos dígitos verificadores', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('normaliza para só dígitos e explica o erro', () => {
    expect(normalizeCpfCnpj(' 529.982.247-25 ')).toBe('52998224725');
    expect(normalizeCpfCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(() => normalizeCpfCnpj('529.982.247-26')).toThrow('CPF inválido');
    expect(() => normalizeCpfCnpj('11.222.333/0001-82')).toThrow(
      'CNPJ inválido',
    );
    expect(() => normalizeCpfCnpj('123')).toThrow(InvalidDocumentError);
  });

  it('protege: cifrado decifra de volta, hash estável, máscara sem o número todo', () => {
    const protectedDoc = protectDocument('52998224725', key);

    expect(decryptSecret(protectedDoc.documentEncrypted, key)).toBe(
      '52998224725',
    );
    expect(protectedDoc.documentEncrypted).not.toContain('52998224725');
    expect(protectedDoc.documentHash).toBe(hashDocument('52998224725', key));
    expect(protectedDoc.documentHash).not.toContain('52998224725');
    expect(protectedDoc.documentMasked).toBe('***.***.*47-25');
  });

  it('o hash depende da chave mestra (não é um sha256 puro do CPF)', () => {
    expect(hashDocument('52998224725', key)).not.toBe(
      hashDocument('52998224725', randomBytes(32)),
    );
  });

  it('reconhece busca com cara de documento', () => {
    expect(looksLikeDocument('529.982.247-25')).toBe(true);
    expect(looksLikeDocument('11222333000181')).toBe(true);
    expect(looksLikeDocument('Ana 52998224725')).toBe(false);
    expect(looksLikeDocument('123')).toBe(false);
  });
});
