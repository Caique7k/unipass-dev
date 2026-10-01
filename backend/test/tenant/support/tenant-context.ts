import { PrismaService } from 'src/prisma/prisma.service';
import { buildServices, TenantServices } from './services';
import { connectTestDatabase, resetDatabase } from './test-database';
import { seedTwoCompanies, TwoCompanies } from './two-companies.fixture';

export type TenantTestContext = TwoCompanies & {
  prisma: PrismaService;
  services: TenantServices;
};

/**
 * Conecta no banco de teste uma vez por arquivo e, antes de cada teste,
 * zera tudo e recria as duas empresas — nenhum teste depende de outro.
 * Os campos do objeto devolvido só ficam prontos dentro dos testes.
 */
export function useTwoCompanies(): TenantTestContext {
  const context = {} as TenantTestContext;

  beforeAll(async () => {
    context.prisma = await connectTestDatabase();
    context.services = buildServices(context.prisma);
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
    Object.assign(context, await seedTwoCompanies(context.prisma));
  });

  afterAll(async () => {
    await context.prisma?.$disconnect();
  });

  return context;
}
