import { PrismaService } from 'src/prisma/prisma.service';

// O banco descartável do docker-compose.test.yml. A suíte apaga tudo antes de
// cada teste, então ela se recusa a rodar em qualquer outro banco.
export const TEST_DATABASE_HOST = 'postgres-test';
export const TEST_DATABASE_NAME = 'unipass_test';

export function assertTestDatabaseUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    throw new Error(
      'Recusando rodar: DATABASE_URL não definida. Use `npm run test:tenant:docker`.',
    );
  }

  const url = new URL(rawUrl);
  const database = url.pathname.replace(/^\//, '');

  // A mensagem não repete nada da URL: ela pode ter vindo de um .env.
  if (url.hostname !== TEST_DATABASE_HOST || database !== TEST_DATABASE_NAME) {
    throw new Error(
      `Recusando rodar: DATABASE_URL não aponta para ${TEST_DATABASE_HOST}/` +
        `${TEST_DATABASE_NAME}. Use \`npm run test:tenant:docker\`.`,
    );
  }
}

async function assertConnectedToTestDatabase(prisma: PrismaService) {
  const [row] = await prisma.$queryRaw<
    { database: string }[]
  >`SELECT current_database() AS database`;

  if (row?.database !== TEST_DATABASE_NAME) {
    throw new Error(
      `Recusando rodar: a conexão não está no banco ${TEST_DATABASE_NAME}.`,
    );
  }
}

export async function connectTestDatabase() {
  // Checa antes de abrir conexão, para nunca encostar em outro banco.
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    await assertConnectedToTestDatabase(prisma);
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }

  return prisma;
}

/** Esvazia todas as tabelas (menos o histórico de migrações). */
export async function resetDatabase(prisma: PrismaService) {
  await assertConnectedToTestDatabase(prisma);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;

  if (tables.length === 0) {
    return;
  }

  // Nomes vêm do catálogo do Postgres, não de entrada externa.
  const tableList = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );
}
