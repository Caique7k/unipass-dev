import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import {
  PASSWORD_HASH_ROUNDS,
  createDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from './password-hash.util';

const SRC_DIR = join(__dirname, '..');
const UTIL_FILE = 'auth/password-hash.util.ts';

// Qualquer forma de trazer o bcrypt (ou o bcryptjs) para um arquivo:
// `from 'bcrypt'`, `import 'bcrypt'`, `import('bcrypt')`, `require('bcrypt')`.
const BCRYPT_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"`]bcrypt(?:js)?(?:\/[^'"`]*)?['"`]/;

function sourceFiles() {
  return readdirSync(SRC_DIR, { encoding: 'utf8', recursive: true })
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .sort();
}

function importsBcrypt(file: string) {
  return BCRYPT_IMPORT.test(readFileSync(join(SRC_DIR, file), 'utf8'));
}

describe('password-hash.util', () => {
  it('hashPassword grava com PASSWORD_HASH_ROUNDS e verifyPassword confere', async () => {
    const hash = await hashPassword('senha-de-teste');

    expect(bcrypt.getRounds(hash)).toBe(PASSWORD_HASH_ROUNDS);
    await expect(verifyPassword('senha-de-teste', hash)).resolves.toBe(true);
    await expect(verifyPassword('outra-senha', hash)).resolves.toBe(false);
  });

  it('hash falso tem o mesmo custo e vem de bytes novos a cada chamada', async () => {
    const [first, second] = await Promise.all([
      createDummyPasswordHash(),
      createDummyPasswordHash(),
    ]);

    expect(bcrypt.getRounds(first)).toBe(PASSWORD_HASH_ROUNDS);
    expect(bcrypt.getRounds(second)).toBe(PASSWORD_HASH_ROUNDS);
    expect(first).not.toBe(second);
  });
});

describe('só o password-hash.util importa bcrypt', () => {
  it.each([
    "import * as bcrypt from 'bcrypt';",
    'import { hash } from "bcrypt";',
    "import {\n  compare,\n} from 'bcrypt';",
    "import bcrypt from 'bcryptjs';",
    "import 'bcrypt';",
    "const bcrypt = require('bcrypt');",
    "import bcrypt = require ( 'bcrypt' );",
    "const bcrypt = await import('bcrypt');",
    "export { hash } from 'bcrypt';",
  ])('a guarda reconhece %p', (snippet) => {
    expect(BCRYPT_IMPORT.test(snippet)).toBe(true);
  });

  it.each([
    "import { hashPassword } from './password-hash.util';",
    "import { x } from './bcrypt-helper';",
    '// a senha passa pelo bcrypt no util',
  ])('a guarda ignora %p', (snippet) => {
    expect(BCRYPT_IMPORT.test(snippet)).toBe(false);
  });

  it('nenhum arquivo de src/ fora do util importa bcrypt', () => {
    const files = sourceFiles();

    // Confere que a varredura leu os arquivos de verdade.
    expect(files).toContain(UTIL_FILE);
    expect(importsBcrypt(UTIL_FILE)).toBe(true);

    const offenders = files.filter(
      (file) => file !== UTIL_FILE && importsBcrypt(file),
    );

    expect(offenders).toEqual([]);
  });
});
