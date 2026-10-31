import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { buildCorsOptions } from './cors-options.util';

export type HttpSecurityOptions = {
  /** Origens de FRONTEND_URLS, já normalizadas (parseAllowedOrigins). */
  allowedOrigins: readonly string[];
  /** TRUST_PROXY_HOPS já lido (parseTrustProxyHops). 0 = desligado. */
  trustProxyHops: number;
};

/**
 * Camada HTTP que roda antes dos guards, em toda resposta (inclusive 403,
 * 404 e preflight). Chamada pelo main.ts e pelo http-security.spec.ts, que
 * sobe um app Nest mínimo com ela.
 */
export function configureHttpSecurity(
  app: NestExpressApplication,
  options: HttpSecurityOptions,
) {
  // O Express nem gera o cabeçalho; o helmet também o apagaria.
  app.disable('x-powered-by');

  // Com N proxies, req.ip (e req.ips[0], usado pelo SecurityThrottlerGuard)
  // passa a ser o IP anotado pelo proxy mais externo. Desligado, o
  // X-Forwarded-For é ignorado e vale o IP da conexão.
  if (options.trustProxyHops > 0) {
    app.set('trust proxy', options.trustProxyHops);
  }

  // Padrão do helmet. A API só devolve JSON e o painel só a chama por
  // fetch/axios com CORS: Cross-Origin-Resource-Policy só vale para cargas
  // sem CORS (img, iframe), CSP/COOP/X-Frame-Options só para respostas
  // abertas como página, e HSTS só em HTTPS.
  app.use(helmet());

  app.enableCors(buildCorsOptions(options.allowedOrigins));
}
