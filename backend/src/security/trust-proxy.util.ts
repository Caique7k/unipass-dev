/**
 * Lê TRUST_PROXY_HOPS: quantos proxies (nginx, load balancer, Cloudflare...)
 * ficam entre a internet e a API. Vazio ou 0 = desligado (padrão).
 *
 * Só ligue atrás de proxy e com o número exato. O X-Forwarded-For pode ser
 * escrito por qualquer cliente; o Express só pode confiar nos últimos N
 * itens, que foram anotados pelos proxies. Ligado sem proxy (ou com N maior
 * que o real), qualquer um escolhe o próprio req.ip: escapa do limite de
 * requisições (SecurityThrottlerGuard) e passa na allowlist de IP do webhook
 * do Asaas (ASAAS_WEBHOOK_IP_WHITELIST).
 *
 * Valor inválido impede a API de subir, em vez de ligar/desligar calado.
 */
export function parseTrustProxyHops(value?: string | null): number {
  const trimmed = value?.trim() ?? '';

  if (trimmed === '') {
    return 0;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `TRUST_PROXY_HOPS precisa ser um número inteiro >= 0 (quantos proxies ficam na frente da API; vazio ou 0 = desligado). Recebido: "${trimmed}".`,
    );
  }

  return Number(trimmed);
}
