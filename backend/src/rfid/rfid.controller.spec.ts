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
import { RfidController } from './rfid.controller';
import { RfidService } from './rfid.service';

const COMPANY_ID = 'company-1';
const ROLE_HEADER = 'x-test-role';
const LINK_BODY = { studentId: 'student-1', rfidTag: 'AA00AA55' };
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
 * Quem pode chamar as rotas de TAG. O RfidService é falso: aqui só importa
 * quem chega até ele e com quais dados. O que ele faz no banco (inclusive
 * a troca de TAG só dentro da empresa) está em
 * test/tenant/rfid-transport.tenant-spec.ts.
 */
describe('RfidController — papéis', () => {
  let app: INestApplication<App>;
  const rfidService = {
    link: jest.fn(),
    startCapture: jest.fn(),
  };

  const postAs = (role: string, path: string, body: object) =>
    request(app.getHttpServer()).post(path).set(ROLE_HEADER, role).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RfidController],
      providers: [{ provide: RfidService, useValue: rfidService }],
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
    rfidService.link.mockResolvedValue({ id: 'card-1', active: true });
  });

  describe('POST /rfid/link', () => {
    it.each(['ADMIN', 'DRIVER'])(
      '%s vincula a TAG na empresa do usuário logado',
      async (role) => {
        await postAs(role, '/rfid/link', LINK_BODY).expect(201);

        expect(rfidService.link).toHaveBeenCalledTimes(1);
        expect(rfidService.link).toHaveBeenCalledWith(COMPANY_ID, LINK_BODY);
      },
    );

    it('DRIVER também troca a TAG: o replaceExisting chega ao service', async () => {
      const body = { ...LINK_BODY, replaceExisting: true };

      await postAs('DRIVER', '/rfid/link', body).expect(201);

      expect(rfidService.link).toHaveBeenCalledWith(COMPANY_ID, body);
    });

    it.each(['COORDINATOR', 'USER', 'PLATFORM_ADMIN'])(
      '%s leva 403 e nada é vinculado nem trocado',
      async (role) => {
        const response = await postAs(role, '/rfid/link', {
          ...LINK_BODY,
          replaceExisting: true,
        }).expect(403);

        expect(response.body).toEqual(ROLE_REFUSAL);
        expect(rfidService.link).not.toHaveBeenCalled();
      },
    );
  });

  it('a captura de TAG pelo leitor continua só ADMIN', async () => {
    const response = await postAs('DRIVER', '/rfid/capture', {
      deviceId: '11111111-1111-4111-8111-111111111111',
    }).expect(403);

    expect(response.body).toEqual(ROLE_REFUSAL);
    expect(rfidService.startCapture).not.toHaveBeenCalled();
  });
});
