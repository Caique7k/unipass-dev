import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Único arquivo de src/ que importa bcrypt (travado por
 * password-hash.util.spec.ts): toda senha é gravada por hashPassword e
 * conferida por verifyPassword, então o custo abaixo vale para os hashes
 * novos e para o hash falso do login ao mesmo tempo.
 */

/**
 * Custo do bcrypt (2^10 rodadas). Mudar o valor só afeta hashes novos: os
 * já gravados continuam com o custo antigo até a senha ser trocada.
 */
export const PASSWORD_HASH_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_HASH_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Hash de uma senha que ninguém conhece (bytes aleatórios, novos a cada
 * chamada). O login compara com ele quando o e-mail não existe, para gastar
 * o mesmo tempo de quando existe.
 */
export function createDummyPasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString('base64'));
}
