import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const BACKEND_DIR = join(__dirname, '..');
const EXAMPLE_FILE = '.env.example';

// Onde o backend lê variáveis de ambiente: o código da API e do worker (src/,
// sem os specs) e o Prisma (schema, prisma.config.ts e seed). test/ fica de
// fora: a suíte de banco recebe as variáveis do docker-compose.test.yml.
function scannedFiles() {
  const filesIn = (dir: string, accept: (file: string) => boolean) =>
    readdirSync(join(BACKEND_DIR, dir), { encoding: 'utf8', recursive: true })
      .map((file) => `${dir}/${file.replace(/\\/g, '/')}`)
      .filter(accept);

  return [
    ...filesIn(
      'src',
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    ),
    ...filesIn('prisma', (file) => /\.(ts|prisma)$/.test(file)),
    'prisma.config.ts',
  ].sort();
}

// Leituras com nome fixo (\s também pega quebra de linha):
// - configService.get('NOME'), .get<string>(\n  'NOME',\n), .getOrThrow("NOME"):
//   qualquer objeto, nome em MAIÚSCULAS entre aspas (renomear o configService
//   não escapa);
// - process.env.NOME e process.env['NOME'];
// - env("NOME") do schema.prisma e do prisma.config.ts.
const NAMED_READS = [
  /\.\s*(?:get|getOrThrow)\s*(?:<[^<>()]*>)?\s*\(\s*(['"`])(?<name>[A-Z][A-Z0-9_]*)\1/g,
  /\bprocess\.env\.(?<name>[A-Z][A-Z0-9_]*)\b/g,
  /\bprocess\.env\[\s*(['"`])(?<name>[A-Z][A-Z0-9_]*)\1\s*\]/g,
  /\benv\(\s*(['"])(?<name>[A-Z][A-Z0-9_]*)\1\s*\)/g,
];

// Leituras sem nome fixo, que não dá para conferir: process.env[variavel],
// { ...process.env }, const { X } = process.env, configService.get(variavel)
// e .getOrThrow(variavel). Limite: um ConfigService com outro nome lendo por
// variável (cfg.get(chave)) não é visto; hoje só existem configService e config.
// Depois do "(", o (?![\s'"`]) exige que o 1º argumento não seja texto entre
// aspas, mesmo com quebra de linha antes dele.
const DYNAMIC_READS = [
  /\bprocess\.env\b(?!\s*\.\s*[A-Za-z_]|\s*\[\s*['"`])/g,
  /\b(?:config|configService)\s*\.\s*(?:get|getOrThrow)\s*(?:<[^<>()]*>)?\s*\(\s*(?![\s'"`])/g,
  /\.\s*getOrThrow\s*(?:<[^<>()]*>)?\s*\(\s*(?![\s'"`])/g,
];

// No exemplo: "NOME=" (preencher/conferir) ou "# NOME=padrão" (opcional).
// Comentário em prosa nunca começa com "NOME=".
const EXAMPLE_LINE = /^(?:#\s?)?(?<name>[A-Z][A-Z0-9_]*)=/;

function namedReads(source: string) {
  const names = NAMED_READS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match.groups!.name),
  );
  return [...new Set(names)].sort();
}

function dynamicReads(source: string) {
  return DYNAMIC_READS.flatMap((pattern) =>
    [...source.matchAll(pattern)].map(
      (match) => source.slice(match.index).split('\n')[0],
    ),
  );
}

function exampleNames(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => EXAMPLE_LINE.exec(line)?.groups?.name)
    .filter((name): name is string => Boolean(name));
}

function readBackendFile(file: string) {
  return readFileSync(join(BACKEND_DIR, file), 'utf8');
}

describe('como a guarda acha as variáveis de ambiente', () => {
  it.each([
    ["this.configService.get<string>('APP_TIMEZONE')", 'APP_TIMEZONE'],
    [
      "this.configService\n      .get<string>('SMS_PROVIDER')\n      ?.trim()",
      'SMS_PROVIDER',
    ],
    [
      "this.configService.get<string>(\n  'TWILIO_MESSAGING_SERVICE_SID',\n);",
      'TWILIO_MESSAGING_SERVICE_SID',
    ],
    ['configService.getOrThrow<string>("JWT_SECRET")', 'JWT_SECRET'],
    ['secret: cfg.get(`OUTRA_CHAVE`)', 'OUTRA_CHAVE'],
    ['const url = process.env.DATABASE_URL;', 'DATABASE_URL'],
    ["const host = process.env['REDIS_HOST'];", 'REDIS_HOST'],
    ['  url      = env("DATABASE_URL")', 'DATABASE_URL'],
  ])('reconhece %p', (snippet, name) => {
    expect(namedReads(snippet)).toEqual([name]);
    expect(dynamicReads(snippet)).toEqual([]);
  });

  it.each([
    "request.headers.get('x-api-key')",
    'this.cache.get(id)',
    'this.reflector.get(IS_PUBLIC_KEY, context.getHandler())',
    "statuses.get('pending')",
  ])('ignora %p', (snippet) => {
    expect(namedReads(snippet)).toEqual([]);
    expect(dynamicReads(snippet)).toEqual([]);
  });

  it.each([
    'const value = process.env[name];',
    'const env = { ...process.env };',
    'const { PORT } = process.env;',
    'this.configService.get<string>(key)',
    'config.get(chave)',
    'settings.getOrThrow<string>(nome)',
  ])('acusa leitura sem nome fixo: %p', (snippet) => {
    expect(dynamicReads(snippet)).not.toEqual([]);
  });

  it('lê do exemplo as linhas "NOME=" e "# NOME=", e nenhum comentário em prosa', () => {
    const content = [
      '# --- Login ---',
      '# JWT_SECRET (obrigatória): gere com openssl rand -base64 48',
      'JWT_SECRET=',
      '# PORT (opcional, padrão 4000): porta da API.',
      '# PORT=4000',
      '# Em produção: ASAAS_ENV=production',
      '',
    ].join('\r\n');

    expect(exampleNames(content)).toEqual(['JWT_SECRET', 'PORT']);
  });
});

describe('backend/.env.example tem todas as variáveis que o backend lê', () => {
  const files = scannedFiles();
  const filesByName = new Map<string, string[]>();
  for (const file of files) {
    for (const name of namedReads(readBackendFile(file))) {
      filesByName.set(name, [...(filesByName.get(name) ?? []), file]);
    }
  }
  const documented = exampleNames(readBackendFile(EXAMPLE_FILE));

  it('a varredura leu os arquivos de verdade', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/main.ts',
        'src/worker.ts',
        'prisma/schema.prisma',
        'prisma.config.ts',
      ]),
    );
    expect(filesByName.get('DATABASE_URL')).toContain('prisma/schema.prisma');
    expect(filesByName.get('JWT_SECRET')).toContain('src/auth/jwt.strategy.ts');
    expect(filesByName.get('TWILIO_MESSAGING_SERVICE_SID')).toEqual([
      'src/companies/companies.service.ts',
    ]);
  });

  it('nenhuma leitura sem nome fixo', () => {
    const offenders = files.flatMap((file) =>
      dynamicReads(readBackendFile(file)).map(
        (snippet) => `${file}: ${snippet}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it('toda variável lida está no exemplo', () => {
    const missing = [...filesByName]
      .filter(([name]) => !documented.includes(name))
      .map(([name, where]) => `${name} (lida em ${where.join(', ')})`);

    expect(missing).toEqual([]);
  });

  it('toda variável do exemplo é lida por alguém', () => {
    const unused = documented.filter((name) => !filesByName.has(name));

    expect(unused).toEqual([]);
  });

  it('nenhuma variável aparece duas vezes no exemplo', () => {
    const repeated = documented.filter(
      (name, index) => documented.indexOf(name) !== index,
    );

    expect(repeated).toEqual([]);
  });
});
