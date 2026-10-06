export type AsaasErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'unexpected';

export type AsaasErrorDetail = {
  code: string | null;
  description: string | null;
};

/**
 * Erro de uma chamada ao Asaas. Carrega só o necessário para decidir o que
 * mostrar: nunca a chave, nunca os headers e nunca o corpo enviado.
 */
export class AsaasApiError extends Error {
  constructor(
    readonly kind: AsaasErrorKind,
    readonly operation: string,
    readonly status: number | null,
    readonly details: AsaasErrorDetail[] = [],
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(
      `Asaas ${operation} falhou (${kind}${status ? ` ${status}` : ''})` +
        (details.length
          ? `: ${details.map((detail) => detail.code ?? '?').join(', ')}`
          : ''),
    );
    this.name = 'AsaasApiError';
  }
}
