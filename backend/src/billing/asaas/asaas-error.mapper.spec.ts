import { AsaasApiError } from './asaas-api.error';
import { describeAsaasError } from './asaas-error.mapper';

describe('describeAsaasError', () => {
  it('chave recusada cita o ambiente em uso', () => {
    const message = describeAsaasError(
      new AsaasApiError('unauthorized', 'commercialInfo', 401),
      'sandbox',
    );

    expect(message).toContain('recusou a chave');
    expect(message).toContain('Sandbox');
  });

  it('erro de validação mostra as descrições do Asaas (no máximo 3, cortadas)', () => {
    const message = describeAsaasError(
      new AsaasApiError('validation', 'createPayment', 400, [
        { code: 'a', description: 'Primeira.' },
        { code: 'b', description: 'Segunda.' },
        { code: 'c', description: 'Terceira.' },
        { code: 'd', description: 'Quarta.' },
        { code: 'e', description: 'x'.repeat(500) },
      ]),
    );

    expect(message).toContain('Primeira.');
    expect(message).toContain('Terceira.');
    expect(message).not.toContain('Quarta.');
  });

  it('429 informa quanto esperar', () => {
    expect(
      describeAsaasError(new AsaasApiError('rate_limited', 'x', 429, [], 30)),
    ).toContain('30 segundos');
  });

  it('indisponível, timeout e rede têm mensagens próprias', () => {
    expect(
      describeAsaasError(new AsaasApiError('unavailable', 'x', 503)),
    ).toContain('indisponível');
    expect(
      describeAsaasError(new AsaasApiError('timeout', 'x', null)),
    ).toContain('demorou');
    expect(
      describeAsaasError(new AsaasApiError('network', 'x', null)),
    ).toContain('comunicar');
  });

  it('erro desconhecido não expõe a mensagem interna', () => {
    const message = describeAsaasError(
      new Error('ECONNRESET at socket 10.0.0.1 stack...'),
    );

    expect(message).not.toContain('ECONNRESET');
    expect(message).not.toContain('10.0.0.1');
  });
});
