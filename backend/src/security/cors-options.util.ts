import { ForbiddenException } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { normalizeOrigin } from './allowed-origins.util';

export const CORS_ORIGIN_NOT_ALLOWED = 'Origin not allowed by CORS';

/**
 * Quem passa pelo CORS. Sem Origin (UniHub, webhook do Asaas, curl, Postman)
 * passa: CORS é regra de navegador. Com Origin, só as de FRONTEND_URLS,
 * comparadas já normalizadas (esquema + host + porta).
 */
export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  return normalizedOrigin !== null && allowedOrigins.includes(normalizedOrigin);
}

/**
 * Opções do app.enableCors. Origem recusada vira ForbiddenException: o Nest
 * responde 403 (como um guard que recusa), sem log de erro, e o pacote cors
 * não põe nenhum cabeçalho Access-Control-*. Um Error comum aqui virava 500,
 * com stack no log a cada tentativa.
 */
export function buildCorsOptions(
  allowedOrigins: readonly string[],
): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new ForbiddenException(CORS_ORIGIN_NOT_ALLOWED));
    },
    credentials: true,
  };
}
