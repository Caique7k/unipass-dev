import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildCorsOptions } from './cors-options.util';

export type HttpSecurityOptions = {
  /** Origens de FRONTEND_URLS, já normalizadas (parseAllowedOrigins). */
  allowedOrigins: readonly string[];
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
  app.enableCors(buildCorsOptions(options.allowedOrigins));
}
