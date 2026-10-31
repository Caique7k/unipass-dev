import { ForbiddenException } from '@nestjs/common';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import { buildCorsOptions, isCorsOriginAllowed } from './cors-options.util';

const ALLOWED = ['http://localhost:3000', 'https://painel.unipass.test'];

describe('isCorsOriginAllowed', () => {
  it.each([undefined, ''])(
    'sem Origin (%p) passa: UniHub, webhook do Asaas, curl',
    (origin) => {
      expect(isCorsOriginAllowed(origin, ALLOWED)).toBe(true);
    },
  );

  it.each([
    'http://localhost:3000',
    'https://painel.unipass.test',
    'https://painel.unipass.test/',
    'HTTPS://PAINEL.UNIPASS.TEST',
  ])(
    'origem de FRONTEND_URLS passa (normalizada, como antes): %s',
    (origin) => {
      expect(isCorsOriginAllowed(origin, ALLOWED)).toBe(true);
    },
  );

  it.each([
    'https://site-malicioso.example',
    'http://localhost:3001',
    'https://localhost:3000',
    'http://painel.unipass.test',
    'null',
    'isto não é uma url',
  ])('origem fora da lista é recusada: %s', (origin) => {
    expect(isCorsOriginAllowed(origin, ALLOWED)).toBe(false);
  });
});

describe('buildCorsOptions', () => {
  const options = buildCorsOptions(ALLOWED);

  // O callback do cors é síncrono: guarda o que a regra respondeu.
  function decide(origin: string | undefined) {
    const answers: Array<{ err: Error | null; allow?: unknown }> = [];

    (options.origin as CustomOrigin)(origin, (err, allow) => {
      answers.push({ err, allow });
    });

    return answers;
  }

  it('mantém credentials: true (cookie de sessão do painel)', () => {
    expect(options.credentials).toBe(true);
  });

  it.each([undefined, 'http://localhost:3000'])(
    'sem Origin ou origem permitida (%p): callback(null, true)',
    (origin) => {
      expect(decide(origin)).toEqual([{ err: null, allow: true }]);
    },
  );

  it('origem recusada: ForbiddenException (403), nunca um Error comum que vira 500', () => {
    const answers = decide('https://site-malicioso.example');

    expect(answers).toHaveLength(1);

    const [{ err, allow }] = answers;

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getStatus()).toBe(403);
    expect(err?.message).toBe('Origin not allowed by CORS');
    expect(allow).toBeUndefined();
  });
});
