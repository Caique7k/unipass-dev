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
import { BillingGatewayController } from './billing-gateway.controller';
import { BillingGatewayService } from './billing-gateway.service';

const COMPANY_ID = 'company-1';
const ROLE_HEADER = 'x-test-role';
const API_KEY = '$aact_hmlg_chave_de_teste_000000000000000000';

type TestRequest = {
  headers: Record<string, string | undefined>;
  user?: {
    id: string;
    email: string;
    role?: string;
    companyId: string | null;
  };
};

// Faz o papel do JwtAuthGuard: o papel vem do header do teste.
const fakeLogin: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<TestRequest>();
    const role = req.headers[ROLE_HEADER];

    req.user = {
      id: 'user-1',
      email: 'admin@empresa.test',
      role,
      companyId: role === 'PLATFORM_ADMIN' ? null : COMPANY_ID,
    };

    return true;
  },
};

/**
 * Só o ADMIN da empresa configura o gateway (a chave de API entra por aqui).
 * O service é falso; o que ele faz no banco está em
 * billing-gateway.service.spec.ts e test/tenant/billing.tenant-spec.ts.
 */
describe('BillingGatewayController — papéis', () => {
  let app: INestApplication<App>;
  const service = {
    getGateway: jest.fn(() => ({ gateway: 'EXTERNAL' })),
    setGateway: jest.fn(() => ({})),
    saveCredentials: jest.fn(() => ({})),
    removeCredentials: jest.fn(() => ({})),
    testConnection: jest.fn(() => ({})),
    configureWebhook: jest.fn(() => ({})),
  };

  const routes = [
    ['get', '/billing/gateway', undefined],
    ['patch', '/billing/gateway', { gateway: 'ASAAS' }],
    ['put', '/billing/gateway/asaas/credentials', { apiKey: API_KEY }],
    ['delete', '/billing/gateway/asaas/credentials', undefined],
    ['post', '/billing/gateway/asaas/test', undefined],
    ['post', '/billing/gateway/asaas/webhook', undefined],
  ] as const;

  const call = (
    role: string,
    method: (typeof routes)[number][0],
    path: string,
    body?: object,
  ) => {
    const pending = request(app.getHttpServer())
      [method](path)
      .set(ROLE_HEADER, role);
    return body ? pending.send(body) : pending;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BillingGatewayController],
      providers: [{ provide: BillingGatewayService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeLogin)
      .compile();

    app = moduleRef.createNestApplication();
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

  beforeEach(() => jest.clearAllMocks());

  it.each(routes)(
    'ADMIN chega ao service: %s %s',
    async (method, path, body) => {
      const response = await call('ADMIN', method, path, body);

      expect(response.status).toBeLessThan(300);
      expect(
        Object.values(service).some((fn) => fn.mock.calls.length === 1),
      ).toBe(true);
    },
  );

  it.each(['COORDINATOR', 'DRIVER', 'USER', 'PLATFORM_ADMIN'])(
    '%s recebe 403 em todas as rotas e nada chega ao service',
    async (role) => {
      for (const [method, path, body] of routes) {
        await call(role, method, path, body).expect(403);
      }

      for (const fn of Object.values(service)) {
        expect(fn).not.toHaveBeenCalled();
      }
    },
  );

  it('a empresa e o autor vêm do login, nunca do corpo', async () => {
    await call('ADMIN', 'put', '/billing/gateway/asaas/credentials', {
      apiKey: API_KEY,
    }).expect(200);

    expect(service.saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        companyId: COMPANY_ID,
        email: 'admin@empresa.test',
      }),
      API_KEY,
    );
  });

  it('gateway desconhecido ou campo extra dá 400', async () => {
    await call('ADMIN', 'patch', '/billing/gateway', {
      gateway: 'PLATFORM_GATEWAY',
    }).expect(400);
    await call('ADMIN', 'put', '/billing/gateway/asaas/credentials', {
      apiKey: API_KEY,
      companyId: 'outra-empresa',
    }).expect(400);
    await call('ADMIN', 'put', '/billing/gateway/asaas/credentials', {
      apiKey: 'curta',
    }).expect(400);

    expect(service.setGateway).not.toHaveBeenCalled();
    expect(service.saveCredentials).not.toHaveBeenCalled();
  });
});
