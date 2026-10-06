import { randomBytes } from 'node:crypto';
import {
  BillingEncryptionKeyError,
  decryptSecret,
  encryptSecret,
  generateSecretToken,
  hashSecret,
  maskDocument,
  parseEncryptionKey,
} from './billing-crypto.util';

const SECRET = '$aact_hmlg_000000000000000000000000000000000000000000000';

describe('billing-crypto.util', () => {
  const key = randomBytes(32);

  it('cifra e decifra de volta, sem o texto original no resultado', () => {
    const stored = encryptSecret(SECRET, key);

    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('aact');
    expect(decryptSecret(stored, key)).toBe(SECRET);
  });

  it('cada cifragem usa um IV novo', () => {
    expect(encryptSecret(SECRET, key)).not.toBe(encryptSecret(SECRET, key));
  });

  it('recusa texto adulterado', () => {
    const [version, iv, tag, encrypted] = encryptSecret(SECRET, key).split(':');
    const bytes = Buffer.from(encrypted, 'base64');
    bytes[0] ^= 0xff;
    const tampered = [version, iv, tag, bytes.toString('base64')].join(':');

    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('recusa decifrar com outra chave mestra', () => {
    const stored = encryptSecret(SECRET, key);

    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it('exige BILLING_ENCRYPTION_KEY com 32 bytes em base64', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(
      BillingEncryptionKeyError,
    );
    expect(() => parseEncryptionKey('   ')).toThrow(BillingEncryptionKeyError);
    expect(() =>
      parseEncryptionKey(randomBytes(16).toString('base64')),
    ).toThrow(BillingEncryptionKeyError);
    expect(parseEncryptionKey(key.toString('base64')).equals(key)).toBe(true);
  });

  it('token do webhook: 48 caracteres alfanuméricos (o Asaas pede 32 a 255)', () => {
    const token = generateSecretToken();

    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(generateSecretToken()).not.toBe(token);
  });

  it('hash é determinístico e não contém o segredo', () => {
    expect(hashSecret('abc')).toBe(hashSecret('abc'));
    expect(hashSecret('abc')).not.toContain('abc');
  });

  it('mascara CPF e CNPJ mostrando só o final', () => {
    expect(maskDocument('123.456.789-01')).toBe('***.***.*89-01');
    expect(maskDocument('12345678000190')).toBe('**.***.***/0001-90');
    expect(maskDocument('12')).toBe('***12');
    expect(maskDocument(null)).toBeNull();
    expect(maskDocument('')).toBeNull();
  });
});
