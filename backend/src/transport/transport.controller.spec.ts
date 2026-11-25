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
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';

const USER_ID = 'user-1';
const COMPANY_ID = 'company-1';
const ROLE_HEADER = 'x-test-role';
const TRIP = { studentName: 'Ana', onBoard: false, events: [] };
const BOARDING_BODY = { deviceIdentifier: 'UNP-AAAA', rfidTag: 'AA00AA55' };
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
      id: USER_ID,
      role,
      companyId: role === 'PLATFORM_ADMIN' ? null : COMPANY_ID,
    };

    return true;
  },
};

/**
 * Quem pode chamar as rotas de /transport e o que chega ao service. O
 * TransportService é falso: o que ele consulta está em
 * transport.service.spec.ts e, com banco de verdade, em
 * test/tenant/my-trip.tenant-spec.ts.
 */
describe('TransportController — papéis', () => {
  let app: INestApplication<App>;
  const transportService = {
    getMyTripToday: jest.fn(),
    getDailyBoardingOverview: jest.fn(),
    registerBoarding: jest.fn(),
    registerDeboarding: jest.fn(),
  };

  const getAs = (role: string, path: string) =>
    request(app.getHttpServer()).get(path).set(ROLE_HEADER, role);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TransportController],
      providers: [{ provide: TransportService, useValue: transportService }],
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
    transportService.getMyTripToday.mockResolvedValue(TRIP);
  });

  describe('GET /transport/me/today', () => {
    it('USER vê a própria viagem: o service recebe o id e a empresa do login', async () => {
      const response = await getAs('USER', '/transport/me/today').expect(200);

      expect(response.body).toEqual(TRIP);
      expect(transportService.getMyTripToday).toHaveBeenCalledTimes(1);
      expect(transportService.getMyTripToday).toHaveBeenCalledWith(
        USER_ID,
        COMPANY_ID,
      );
    });

    it('ids na query são ignorados: valem os do login', async () => {
      await getAs(
        'USER',
        '/transport/me/today?id=user-2&userId=user-2&studentId=student-2&companyId=company-2',
      ).expect(200);

      expect(transportService.getMyTripToday).toHaveBeenCalledTimes(1);
      expect(transportService.getMyTripToday).toHaveBeenCalledWith(
        USER_ID,
        COMPANY_ID,
      );
    });

    it.each(['ADMIN', 'DRIVER', 'COORDINATOR', 'PLATFORM_ADMIN'])(
      '%s leva 403 e nenhuma viagem é consultada',
      async (role) => {
        const response = await getAs(role, '/transport/me/today').expect(403);

        expect(response.body).toEqual(ROLE_REFUSAL);
        expect(transportService.getMyTripToday).not.toHaveBeenCalled();
      },
    );
  });

  describe('as outras rotas continuam fechadas para o USER', () => {
    it('GET /transport/boarding-overview/today', async () => {
      const response = await getAs(
        'USER',
        '/transport/boarding-overview/today',
      ).expect(403);

      expect(response.body).toEqual(ROLE_REFUSAL);
      expect(transportService.getDailyBoardingOverview).not.toHaveBeenCalled();
    });

    it.each([
      ['/transport/boarding', transportService.registerBoarding],
      ['/transport/deboarding', transportService.registerDeboarding],
    ])('POST %s', async (path, method) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .set(ROLE_HEADER, 'USER')
        .send(BOARDING_BODY)
        .expect(403);

      expect(response.body).toEqual(ROLE_REFUSAL);
      expect(method).not.toHaveBeenCalled();
    });
  });
});
