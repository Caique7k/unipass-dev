import { parseTrustProxyHops } from './trust-proxy.util';

describe('parseTrustProxyHops (TRUST_PROXY_HOPS)', () => {
  it.each([undefined, null, '', '   ', '0'])(
    '%p → 0: trust proxy desligado (o padrão)',
    (value) => {
      expect(parseTrustProxyHops(value)).toBe(0);
    },
  );

  it.each([
    ['1', 1],
    [' 2 ', 2],
    ['3', 3],
  ])('%p → %p proxy(s) na frente da API', (value, hops) => {
    expect(parseTrustProxyHops(value)).toBe(hops);
  });

  it.each([
    'true',
    'false',
    '-1',
    '1.5',
    '1e2',
    'abc',
    'loopback',
    '10.0.0.1',
    '1,2',
  ])('%p é recusado e impede a API de subir', (value) => {
    expect(() => parseTrustProxyHops(value)).toThrow(
      /TRUST_PROXY_HOPS precisa ser um número inteiro >= 0/,
    );
  });
});
