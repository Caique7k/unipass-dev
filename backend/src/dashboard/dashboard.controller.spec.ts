import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

const COMPANY_ID = 'company-1';
const OTHER_COMPANY_ID = 'company-2';
const ROLE_HEADER = 'x-test-role';
// Resposta do RolesGuard em toda rota com @Roles quando o papel não tem acesso.
const ROLE_REFUSAL = {
  statusCode: 403,
  message: 'Forbidden resource',
  error: 'Forbidden',
};

type TestRequest = {
  headers: Record<string, string | undefined>;
  user?: { id: string; role?: string; companyId: string | null };
};

// Faz o papel do JwtAuthGuard: põe em req.user o usuário que o JwtStrategy
// carregaria do banco, com o papel vindo do header do teste.
const fakeLogin: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<TestRequest>();
    const role = req.headers[ROLE_HEADER];

    req.user = {
      id: 'user-1',
      role,
      companyId: role === 'PLATFORM_ADMIN' ? null : COMPANY_ID,
    };

    return true;
  },
};

/**
 * Quem vê o painel e os relatórios, e o que chega ao service. O
 * DashboardService é falso: o que ele consulta está em
 * dashboard.service.spec.ts.
 */
describe('DashboardController — papéis e entrada', () => {
  let app: INestApplication<App>;
  const dashboardService = {
    getMetrics: jest.fn(),
    getReport: jest.fn(),
  };

  const getAs = (role: string, path: string) =>
    request(app.getHttpServer()).get(path).set(ROLE_HEADER, role);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [{ provide: DashboardService, useValue: dashboardService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeLogin)
      .compile();

    app = moduleRef.createNestApplication();
    // Mesmas opções do ValidationPipe global em main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    dashboardService.getMetrics.mockResolvedValue({ painel: true });
    dashboardService.getReport.mockResolvedValue({ relatorio: true });
  });

  describe('GET /dashboard', () => {
    it.each(['ADMIN', 'DRIVER', 'COORDINATOR'])(
      '%s vê o painel da própria empresa, com o próprio papel',
      async (role) => {
        const response = await getAs(role, '/dashboard').expect(200);

        expect(response.body).toEqual({ painel: true });
        expect(dashboardService.getMetrics).toHaveBeenCalledTimes(1);
        expect(dashboardService.getMetrics).toHaveBeenCalledWith(
          COMPANY_ID,
          role,
        );
      },
    );

    it.each(['USER', 'PLATFORM_ADMIN'])(
      '%s leva 403 e o painel não é montado',
      async (role) => {
        const response = await getAs(role, '/dashboard').expect(403);

        expect(response.body).toEqual(ROLE_REFUSAL);
        expect(dashboardService.getMetrics).not.toHaveBeenCalled();
      },
    );

    it('empresa e papel na query são ignorados: valem os do usuário logado', async () => {
      await getAs(
        'DRIVER',
        `/dashboard?companyId=${OTHER_COMPANY_ID}&role=ADMIN`,
      ).expect(200);

      expect(dashboardService.getMetrics).toHaveBeenCalledWith(
        COMPANY_ID,
        'DRIVER',
      );
    });
  });

  describe('GET /dashboard/reports', () => {
    it('ADMIN vê os relatórios da própria empresa, com os filtros validados', async () => {
      const response = await getAs(
        'ADMIN',
        '/dashboard/reports?reportType=fleet&startDate=2026-10-01&endDate=2026-10-07&eventType=DENIED&studentStatus=active&busId=%20bus-1%20',
      ).expect(200);

      expect(response.body).toEqual({ relatorio: true });
      expect(dashboardService.getReport).toHaveBeenCalledTimes(1);
      expect(dashboardService.getReport).toHaveBeenCalledWith(COMPANY_ID, {
        reportType: 'fleet',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        eventType: 'DENIED',
        studentStatus: 'active',
        busId: 'bus-1',
      });
    });

    it.each(['DRIVER', 'COORDINATOR', 'USER', 'PLATFORM_ADMIN'])(
      '%s leva 403 e nenhum relatório é montado',
      async (role) => {
        const response = await getAs(role, '/dashboard/reports').expect(403);

        expect(response.body).toEqual(ROLE_REFUSAL);
        expect(dashboardService.getReport).not.toHaveBeenCalled();
      },
    );

    it('companyId na query é recusado (400) e nenhum relatório é montado', async () => {
      await getAs(
        'ADMIN',
        `/dashboard/reports?companyId=${OTHER_COMPANY_ID}`,
      ).expect(400);

      expect(dashboardService.getReport).not.toHaveBeenCalled();
    });

    it.each([
      ['tipo de relatório que não existe', 'reportType=invalido'],
      ['data inicial fora do formato', 'startDate=01/10/2026'],
      ['data final incompleta', 'endDate=2026-10'],
      ['tipo de evento que não existe', 'eventType=QUALQUER'],
      ['situação de aluno que não existe', 'studentStatus=talvez'],
    ])('%s dá 400 e nenhum relatório é montado', async (_case, query) => {
      await getAs('ADMIN', `/dashboard/reports?${query}`).expect(400);

      expect(dashboardService.getReport).not.toHaveBeenCalled();
    });
  });
});
