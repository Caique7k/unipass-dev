import { Controller, Get, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';
import { parseAllowedOrigins } from './allowed-origins.util';
import { CookieOriginGuard } from './cookie-origin.guard';
import { configureHttpSecurity } from './http-security';
import { SecurityThrottlerGuard } from './security-throttler.guard';

const ALLOWED_ORIGIN = 'http://painel.unipass.test:3000';
const OTHER_ORIGIN = 'https://site-malicioso.example';
const SESSION_COOKIE = 'token=sessao-de-teste';
// IP do Asaas usado como exemplo de IP forjado (allowlist do webhook).
const ASAAS_IP = '52.67.12.206';
const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;
const CORS_REFUSAL = {
  statusCode: 403,
  message: 'Origin not allowed by CORS',
  error: 'Forbidden',
};

// Conta quantas vezes a rota de teste rodou de fato.
const routeHits = jest.fn();

@Controller('probe')
class ProbeController {
  @Get()
  read(@Req() req: Request) {
    routeHits();
    return { ip: req.ip };
  }

  @Post()
  write() {
    routeHits();
    return { ok: true };
  }
}

type AppOptions = { trustProxyHops?: number; rateLimit?: number };

/**
 * App Nest mínimo com a mesma camada HTTP do main.ts (configureHttpSecurity)
 * e os dois primeiros guards globais dele, na mesma ordem.
 */
async function createApp({
  trustProxyHops = 0,
  rateLimit = 1000,
}: AppOptions = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: rateLimit }])],
    controllers: [ProbeController],
    providers: [
      SecurityThrottlerGuard,
      CookieOriginGuard,
      // Só o que o CookieOriginGuard lê; sem .env e sem process.env.
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'FRONTEND_URLS' ? ALLOWED_ORIGIN : undefined,
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureHttpSecurity(app, {
    allowedOrigins: parseAllowedOrigins(ALLOWED_ORIGIN),
    trustProxyHops,
  });
  app.useGlobalGuards(
    app.get(SecurityThrottlerGuard),
    app.get(CookieOriginGuard),
  );
  await app.init();

  return app;
}

async function withApp(
  options: AppOptions,
  run: (app: NestExpressApplication) => Promise<void>,
) {
  const app = await createApp(options);

  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function expectHelmetHeaders(headers: Record<string, string>) {
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['strict-transport-security']).toContain('max-age=');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(headers['cross-origin-resource-policy']).toBe('same-origin');
}

describe('Segurança HTTP do main.ts (CORS, helmet, trust proxy) — app Nest mínimo', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    routeHits.mockClear();
  });

  describe('CORS', () => {
    it('origem fora de FRONTEND_URLS leva 403 sem cabeçalho de CORS, e a rota nem roda', async () => {
      const response = await http()
        .get('/probe')
        .set('Origin', OTHER_ORIGIN)
        .expect(403);

      expect(response.body).toEqual(CORS_REFUSAL);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        response.headers['access-control-allow-credentials'],
      ).toBeUndefined();
      expect(routeHits).not.toHaveBeenCalled();
    });

    it('preflight (OPTIONS) de origem recusada leva 403 sem cabeçalhos de CORS', async () => {
      const response = await http()
        .options('/probe')
        .set('Origin', OTHER_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .expect(403);

      expect(response.body).toEqual(CORS_REFUSAL);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-methods']).toBeUndefined();
    });

    it('Origin "null" (iframe em sandbox, arquivo local) leva 403', async () => {
      const response = await http()
        .get('/probe')
        .set('Origin', 'null')
        .expect(403);

      expect(response.body).toEqual(CORS_REFUSAL);
    });

    it('origem de FRONTEND_URLS recebe os cabeçalhos de CORS, com credenciais', async () => {
      const response = await http()
        .get('/probe')
        .set('Origin', ALLOWED_ORIGIN)
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN,
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['vary']).toContain('Origin');
      expect(routeHits).toHaveBeenCalledTimes(1);
    });

    it('preflight de origem permitida responde 204 com os cabeçalhos de CORS', async () => {
      const response = await http()
        .options('/probe')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe(
        ALLOWED_ORIGIN,
      );
      expect(response.headers['access-control-allow-methods']).toContain(
        'POST',
      );
    });

    it('sem Origin (UniHub, webhook do Asaas, curl) passa como antes, sem Access-Control-Allow-Origin', async () => {
      const response = await http().get('/probe').expect(200);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(routeHits).toHaveBeenCalledTimes(1);
    });
  });

  describe('helmet', () => {
    it('X-Powered-By não aparece em nenhuma resposta (200, 403 do CORS, 404)', async () => {
      const responses = [
        await http().get('/probe').expect(200),
        await http().get('/probe').set('Origin', OTHER_ORIGIN).expect(403),
        await http().get('/rota-que-nao-existe').expect(404),
      ];

      for (const response of responses) {
        expect(response.headers['x-powered-by']).toBeUndefined();
      }
    });

    it('cabeçalhos de segurança do helmet presentes, inclusive no 403 do CORS', async () => {
      const allowed = await http().get('/probe').expect(200);
      const refused = await http()
        .get('/probe')
        .set('Origin', OTHER_ORIGIN)
        .expect(403);

      expectHelmetHeaders(allowed.headers);
      expectHelmetHeaders(refused.headers);
    });
  });

  describe('CSRF: o CookieOriginGuard continua decidindo, depois do CORS', () => {
    it('POST com cookie de sessão vindo da origem permitida passa', async () => {
      await http()
        .post('/probe')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', SESSION_COOKIE)
        .expect(201);

      expect(routeHits).toHaveBeenCalledTimes(1);
    });

    it('POST com cookie, sem Origin e com Sec-Fetch-Site: cross-site: recusado pelo guard (403 dele, não do CORS)', async () => {
      const response = await http()
        .post('/probe')
        .set('Cookie', SESSION_COOKIE)
        .set('Sec-Fetch-Site', 'cross-site')
        .expect(403);

      expect(response.body).toMatchObject({
        message: 'Cross-site session requests are not allowed',
      });
      expect(routeHits).not.toHaveBeenCalled();
    });

    it('POST com cookie, sem Origin e com Referer de outro site: recusado pelo guard', async () => {
      const response = await http()
        .post('/probe')
        .set('Cookie', SESSION_COOKIE)
        .set('Referer', `${OTHER_ORIGIN}/pagina`)
        .expect(403);

      expect(response.body).toMatchObject({
        message: 'Referer not allowed for authenticated request',
      });
      expect(routeHits).not.toHaveBeenCalled();
    });

    it('POST com cookie vindo de origem recusada para antes, no CORS', async () => {
      const response = await http()
        .post('/probe')
        .set('Origin', OTHER_ORIGIN)
        .set('Cookie', SESSION_COOKIE)
        .expect(403);

      expect(response.body).toEqual(CORS_REFUSAL);
      expect(routeHits).not.toHaveBeenCalled();
    });
  });

  describe('trust proxy (TRUST_PROXY_HOPS)', () => {
    const getWithForwardedFor = (
      target: NestExpressApplication,
      forwardedFor: string,
    ) =>
      request(target.getHttpServer())
        .get('/probe')
        .set('X-Forwarded-For', forwardedFor);

    it('desligado (padrão): X-Forwarded-For forjado não muda o req.ip, que segue o IP da conexão', async () => {
      const response = await getWithForwardedFor(app, ASAAS_IP).expect(200);
      const { ip } = response.body as { ip: string };

      expect(ip).not.toBe(ASAAS_IP);
      expect(ip).toMatch(LOOPBACK);
    });

    it('desligado: trocar o X-Forwarded-For a cada pedido não escapa do limite de requisições', async () => {
      await withApp({ rateLimit: 2 }, async (limited) => {
        await getWithForwardedFor(limited, '198.51.100.1').expect(200);
        await getWithForwardedFor(limited, '198.51.100.2').expect(200);
        await getWithForwardedFor(limited, '198.51.100.3').expect(429);
      });
    });

    it('TRUST_PROXY_HOPS=1: req.ip é o IP anotado pelo proxy (último do X-Forwarded-For); o começo forjado é ignorado', async () => {
      await withApp({ trustProxyHops: 1 }, async (proxied) => {
        const response = await getWithForwardedFor(
          proxied,
          `${ASAAS_IP}, 203.0.113.7`,
        ).expect(200);

        expect(response.body).toEqual({ ip: '203.0.113.7' });
      });
    });

    it('TRUST_PROXY_HOPS=1: forjar o começo do X-Forwarded-For não escapa do limite', async () => {
      await withApp({ trustProxyHops: 1, rateLimit: 2 }, async (proxied) => {
        await getWithForwardedFor(proxied, '198.51.100.1, 203.0.113.7').expect(
          200,
        );
        await getWithForwardedFor(proxied, '198.51.100.2, 203.0.113.7').expect(
          200,
        );
        await getWithForwardedFor(proxied, '198.51.100.3, 203.0.113.7').expect(
          429,
        );
      });
    });

    it('TRUST_PROXY_HOPS=1 sem proxy de verdade é perigoso: o cliente escolhe o próprio IP (por isso vem desligado)', async () => {
      await withApp({ trustProxyHops: 1, rateLimit: 2 }, async (exposed) => {
        const response = await getWithForwardedFor(exposed, ASAAS_IP).expect(
          200,
        );

        // Passaria na allowlist de IP do webhook do Asaas.
        expect(response.body).toEqual({ ip: ASAAS_IP });

        // Limite de 2 por IP e, mesmo assim, nenhum 429.
        await getWithForwardedFor(exposed, '198.51.100.1').expect(200);
        await getWithForwardedFor(exposed, '198.51.100.2').expect(200);
        await getWithForwardedFor(exposed, '198.51.100.3').expect(200);
      });
    });
  });
});
