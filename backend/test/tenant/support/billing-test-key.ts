import { randomBytes } from 'node:crypto';

/**
 * Chave mestra (BILLING_ENCRYPTION_KEY) só deste processo de teste: a
 * fixture cifra o CPF dos pagadores com ela e os services a recebem pelo
 * ConfigService. Nunca é a chave de dev nem a de produção.
 */
export const TEST_BILLING_KEY = randomBytes(32);
export const TEST_BILLING_KEY_BASE64 = TEST_BILLING_KEY.toString('base64');
