import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../prisma/prisma.service';
import { OpaqueIdService } from '../security/opaque-id.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { hashPassword } from './password-hash.util';

const EMAIL = 'admin@alfa.test';
const PASSWORD = 'senha-certa-123';
// Relógio parado num segundo exato: a conta "exp − agora" fica exata.
const NOW_MS = Date.UTC(2026, 10, 2, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const CUSTOM_COOKIE_ENV = {
  COOKIE_SECURE: 'true',
  COOKIE_SAME_SITE: 'Strict',
  COOKIE_DOMAIN: ' app.test ',
};

type Attributes = Record<string, string | true>;
type SetCookie = { value: string; attributes: Attributes };

// Lê o Set-Cookie do "token" como o navegador recebe: valor e atributos
// (nomes em minúsculas; atributos sem valor, como HttpOnly, viram true).
function tokenCookie(response: request.Response): SetCookie | undefined {
  // O superagent devolve uma lista para Set-Cookie.
  const headers = response.get('Set-Cookie') as unknown as string[] | undefined;
  const raw = headers?.find((header) => header.startsWith('token='));
  if (!raw) {
    return undefined;
  }

  const [pair, ...parts] = raw.split('; ');
  const attributes: Attributes = {};
  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      attributes[part.toLowerCase()] = true;
    } else {
      attributes[part.slice(0, separator).toLowerCase()] = part.slice(
        separator + 1,
      );
    }
  }

  return { value: pair.slice('token='.length), attributes };
}

function withoutExpiry(attributes: Attributes) {
  const rest = { ...attributes };
  delete rest['max-age'];
  delete rest.expires;
  return rest;
}

/**
 * Cookie do login por HTTP, sem banco: AuthController e AuthService reais,
 * JwtService real (o token do cookie é decodificado de verdade), Prisma,
 * ConfigService e OpaqueIdService falsos.
 */
describe('AuthController — cookie do login', () => {
  let app: INestApplication<App>;
  let settings: Record<string, string>;
  let nowSpy: jest.SpyInstance<number, []>;
  const jwtService = new JwtService({ secret: 'segredo-so-de-teste' });
  const config = { get: jest.fn((key: string) => settings[key]) };
  const opaqueIds = { encode: jest.fn((value: string | null) => value) };
  const prisma = { user: { findUnique: jest.fn() } };

  const login = (body: { rememberMe?: boolean; password?: string }) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: PASSWORD, ...body });

  const logout = () => request(app.getHttpServer()).post('/auth/logout');

  const expOf = (token: string) =>
    jwtService.decode<{ exp: number }>(token).exp;

  beforeAll(async () => {
    const userHash = await hashPassword(PASSWORD);
    prisma.user.findUnique.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: EMAIL,
      name: 'Admin Alfa',
      role: UserRole.ADMIN,
      active: true,
      companyId: '22222222-2222-4222-8222-222222222222',
      password: userHash,
      company: { emailDomain: 'alfa.test', name: 'Transportes Alfa' },
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: config },
        { provide: OpaqueIdService, useValue: opaqueIds },
      ],
    }).compile();

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
    settings = { JWT_EXPIRES: '1h', JWT_REMEMBER_EXPIRES: '30d' };
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it.each([
    ['sem rememberMe', {}],
    ['rememberMe: false', { rememberMe: false }],
  ])(
    '%s: cookie de sessão (sem Max-Age nem Expires) e o token não vem no corpo',
    async (_case, body) => {
      const response = await login(body).expect(201);
      const cookie = tokenCookie(response);

      expect(response.body).toEqual({ success: true });
      expect(cookie?.value).toBeTruthy();
      expect(JSON.stringify(response.body)).not.toContain(cookie?.value);
      expect(cookie?.attributes).toEqual({
        path: '/',
        httponly: true,
        samesite: 'Lax',
      });
      // O token em si vale JWT_EXPIRES (1h).
      expect(expOf(cookie!.value)).toBe(NOW_S + 3600);
    },
  );

  it.each([
    ['30d', 30 * 24 * 3600],
    ['7d', 7 * 24 * 3600],
    ['12h', 12 * 3600],
  ])(
    'rememberMe com JWT_REMEMBER_EXPIRES=%s: o cookie vence no mesmo instante que o token',
    async (duration, seconds) => {
      settings.JWT_REMEMBER_EXPIRES = duration;

      const response = await login({ rememberMe: true }).expect(201);
      const cookie = tokenCookie(response);
      const exp = expOf(cookie!.value);

      expect(response.body).toEqual({ success: true });
      expect(JSON.stringify(response.body)).not.toContain(cookie?.value);
      expect(exp).toBe(NOW_S + seconds);
      expect(cookie?.attributes).toEqual({
        'max-age': String(exp - NOW_S),
        expires: new Date(exp * 1000).toUTCString(),
        path: '/',
        httponly: true,
        samesite: 'Lax',
      });
    },
  );

  it('Secure, SameSite e Domain do cookie vêm do ambiente', async () => {
    Object.assign(settings, CUSTOM_COOKIE_ENV);

    const cookie = tokenCookie(await login({ rememberMe: true }).expect(201));

    expect(withoutExpiry(cookie!.attributes)).toEqual({
      domain: 'app.test',
      path: '/',
      httponly: true,
      secure: true,
      samesite: 'Strict',
    });
  });

  it.each([
    ['padrão', {}],
    ['vindas do ambiente', CUSTOM_COOKIE_ENV],
  ])(
    'logout (opções %s) limpa o cookie com as mesmas opções do login',
    async (_case, env) => {
      Object.assign(settings, env);

      const loginCookie = tokenCookie(
        await login({ rememberMe: true }).expect(201),
      );
      const logoutCookie = tokenCookie(await logout().expect(201));

      expect(logoutCookie?.value).toBe('');
      expect(logoutCookie?.attributes.expires).toBe(
        'Thu, 01 Jan 1970 00:00:00 GMT',
      );
      expect(logoutCookie?.attributes['max-age']).toBeUndefined();
      expect(withoutExpiry(logoutCookie!.attributes)).toEqual(
        withoutExpiry(loginCookie!.attributes),
      );
    },
  );

  it('senha errada: 401 e nenhum cookie', async () => {
    const response = await login({ password: 'senha-errada' }).expect(401);

    expect(tokenCookie(response)).toBeUndefined();
  });

  it('e-mail com maiúsculas e espaços chega ao banco em minúsculas', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: '  Admin@ALFA.test ', password: PASSWORD })
      .expect(201);

    expect(prisma.user.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { email: EMAIL } }),
    );
  });
});
