import { createHmac } from 'node:crypto';
import { encryptSecret, maskDocument } from './billing-crypto.util';

/**
 * CPF/CNPJ do pagador. Guardado em três formas, nunca em texto puro:
 * cifrado (para enviar ao gateway), hash (busca exata dentro da empresa) e
 * mascarado (para a tela). Todas derivam da chave mestra
 * BILLING_ENCRYPTION_KEY.
 */
export type ProtectedDocument = {
  documentEncrypted: string;
  documentHash: string;
  documentMasked: string;
};

export class InvalidDocumentError extends Error {}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function allSameDigits(digits: string) {
  return /^(\d)\1+$/.test(digits);
}

export function isValidCpf(value: string) {
  const digits = onlyDigits(value);

  if (digits.length !== 11 || allSameDigits(digits)) {
    return false;
  }

  const checkDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return (
    checkDigit(9) === Number(digits[9]) && checkDigit(10) === Number(digits[10])
  );
}

export function isValidCnpj(value: string) {
  const digits = onlyDigits(value);

  if (digits.length !== 14 || allSameDigits(digits)) {
    return false;
  }

  const checkDigit = (length: number) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + weight * Number(digits[index]),
      0,
    );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return (
    checkDigit(12) === Number(digits[12]) &&
    checkDigit(13) === Number(digits[13])
  );
}

/** Só dígitos; lança InvalidDocumentError com mensagem para o usuário. */
export function normalizeCpfCnpj(value: string) {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    if (!isValidCpf(digits)) {
      throw new InvalidDocumentError('CPF inválido. Confira os números.');
    }
    return digits;
  }

  if (digits.length === 14) {
    if (!isValidCnpj(digits)) {
      throw new InvalidDocumentError('CNPJ inválido. Confira os números.');
    }
    return digits;
  }

  throw new InvalidDocumentError(
    'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).',
  );
}

/** Termo de busca com cara de documento (11 ou 14 dígitos)? */
export function looksLikeDocument(value: string) {
  const digits = onlyDigits(value);
  return (
    (digits.length === 11 || digits.length === 14) &&
    /^[\d.\-/\s]+$/.test(value.trim())
  );
}

// Sub-chave própria do hash: a mesma chave mestra nunca é usada direto em
// dois propósitos (cifra e hash).
function hashKey(masterKey: Buffer) {
  return createHmac('sha256', masterKey)
    .update('unipass:billing-document-hash:v1')
    .digest();
}

export function hashDocument(digits: string, masterKey: Buffer) {
  return createHmac('sha256', hashKey(masterKey)).update(digits).digest('hex');
}

/** Recebe o documento já normalizado (só dígitos). */
export function protectDocument(
  digits: string,
  masterKey: Buffer,
): ProtectedDocument {
  return {
    documentEncrypted: encryptSecret(digits, masterKey),
    documentHash: hashDocument(digits, masterKey),
    documentMasked: maskDocument(digits) as string,
  };
}
