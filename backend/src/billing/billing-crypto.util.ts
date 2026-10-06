import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Cifra em repouso dos segredos financeiros por empresa (hoje: a chave de API
 * do Asaas). AES-256-GCM com a chave mestra BILLING_ENCRYPTION_KEY, que só
 * existe no ambiente do servidor — nunca no banco nem no código.
 *
 * Formato gravado: "v1:<iv>:<tag>:<cifrado>" (base64). O prefixo de versão
 * permite trocar a chave mestra no futuro sem quebrar o que já está gravado.
 */
const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class BillingEncryptionKeyError extends Error {}

export function parseEncryptionKey(rawKey: string | undefined | null) {
  const trimmed = rawKey?.trim();

  if (!trimmed) {
    throw new BillingEncryptionKeyError(
      'BILLING_ENCRYPTION_KEY não está configurada.',
    );
  }

  const key = Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new BillingEncryptionKeyError(
      'BILLING_ENCRYPTION_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32).',
    );
  }

  return key;
}

export function encryptSecret(plainText: string, key: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/** Lança se o texto foi adulterado ou cifrado com outra chave. */
export function decryptSecret(stored: string, key: Buffer) {
  const [version, iv, tag, encrypted] = stored.split(':');

  if (version !== FORMAT_VERSION || !iv || !tag || !encrypted) {
    throw new Error('Formato de segredo cifrado desconhecido.');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Para segredos que só precisam ser conferidos, nunca lidos de volta. */
export function hashSecret(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Token aleatório só com [0-9a-f] (o Asaas pede authToken alfanumérico). */
export function generateSecretToken(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

export function lastFour(value: string) {
  return value.slice(-4);
}

// Mostra só o fim do documento: CNPJ mantém filial e dígitos verificadores,
// CPF mantém os 4 últimos dígitos ("***.***.*89-01").
export function maskDocument(document: string | null | undefined) {
  const digits = document?.replace(/\D/g, '') ?? '';

  if (digits.length === 14) {
    return `**.***.***/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }

  if (digits.length === 11) {
    return `***.***.*${digits.slice(7, 9)}-${digits.slice(9)}`;
  }

  return digits.length > 0 ? `***${digits.slice(-2)}` : null;
}
