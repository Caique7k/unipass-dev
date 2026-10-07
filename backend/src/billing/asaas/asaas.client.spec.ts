import { Logger } from '@nestjs/common';
import { AsaasApiError } from './asaas-api.error';
import { AsaasClient, FetchLike } from './asaas.client';

const API_KEY = '$aact_hmlg_chave_secreta_que_nunca_pode_vazar_0000';
const CONFIG = {
  apiUrl: 'https://api-sandbox.asaas.com/v3',
  environment: 'sandbox' as const,
};

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];

  const fetch = ((url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve(respond(call));
  }) as unknown as FetchLike;

  return { fetch, calls };
}

const json = (
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

describe('AsaasClient', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('autentica pelo header access_token e lê os dados comerciais', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, {
        name: 'Fulano',
        companyName: 'Transportes Teste LTDA',
        cpfCnpj: '12345678000190',
        personType: 'JURIDICA',
        status: 'APPROVED',
      }),
    );

    const info = await new AsaasClient(
      CONFIG,
      API_KEY,
      fetch,
    ).getCommercialInfo();

    expect(calls[0].url).toBe(
      'https://api-sandbox.asaas.com/v3/myAccount/commercialInfo/',
    );
    expect(calls[0].init.method).toBe('GET');
    expect((calls[0].init.headers as Record<string, string>).access_token).toBe(
      API_KEY,
    );
    expect(calls[0].init.signal).toBeDefined();
    expect(info.companyName).toBe('Transportes Teste LTDA');
  });

  it('401 vira AsaasApiError "unauthorized" sem a chave na mensagem nem no log', async () => {
    const { fetch } = fakeFetch(() =>
      json(401, {
        errors: [
          { code: 'invalid_access_token', description: 'Chave inválida' },
        ],
      }),
    );

    const error = await new AsaasClient(CONFIG, API_KEY, fetch)
      .getCommercialInfo()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AsaasApiError);
    expect(error).toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(String((error as Error).message)).not.toContain(API_KEY);
    expect(logged.join('\n')).not.toContain(API_KEY);
    expect(logged.join('\n')).toContain('invalid_access_token');
  });

  it('400 traz os erros no formato oficial { errors: [{ code, description }] }', async () => {
    const { fetch } = fakeFetch(() =>
      json(400, {
        errors: [
          {
            code: 'invalid_value',
            description: 'O campo value deve ser informado',
          },
        ],
      }),
    );

    await expect(
      new AsaasClient(CONFIG, API_KEY, fetch).getCommercialInfo(),
    ).rejects.toMatchObject({
      kind: 'validation',
      details: [
        {
          code: 'invalid_value',
          description: 'O campo value deve ser informado',
        },
      ],
    });
    // A descrição pode ter dado do cliente: não vai para o log.
    expect(logged.join('\n')).not.toContain('deve ser informado');
  });

  it('429 lê RateLimit-Reset', async () => {
    const { fetch } = fakeFetch(() =>
      json(429, {}, { 'RateLimit-Reset': '12' }),
    );

    await expect(
      new AsaasClient(CONFIG, API_KEY, fetch).getCommercialInfo(),
    ).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 12 });
  });

  it('5xx vira "unavailable", mesmo com corpo que não é JSON', async () => {
    const { fetch } = fakeFetch(
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
    );

    await expect(
      new AsaasClient(CONFIG, API_KEY, fetch).getCommercialInfo(),
    ).rejects.toMatchObject({ kind: 'unavailable', status: 502 });
  });

  it('timeout e falha de rede viram erros próprios', async () => {
    const timeoutFetch = (() => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      return Promise.reject(error);
    }) as unknown as FetchLike;
    const networkFetch = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as FetchLike;

    await expect(
      new AsaasClient(CONFIG, API_KEY, timeoutFetch).getCommercialInfo(),
    ).rejects.toMatchObject({ kind: 'timeout', status: null });
    await expect(
      new AsaasClient(CONFIG, API_KEY, networkFetch).getCommercialInfo(),
    ).rejects.toMatchObject({ kind: 'network', status: null });
  });

  it('cria cliente e cobrança BOLETO com os campos da API, sem CPF no log', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url.endsWith('/customers')
        ? json(200, { id: 'cus_1' })
        : json(200, {
            id: 'pay_1',
            status: 'PENDING',
            bankSlipUrl: 'https://sandbox.asaas.com/b/pdf/pay_1',
            invoiceUrl: 'https://sandbox.asaas.com/i/pay_1',
            externalReference: 'ref-1',
          }),
    );
    const client = new AsaasClient(CONFIG, API_KEY, fetch);

    const customer = await client.createCustomer({
      name: 'Responsável',
      cpfCnpj: '52998224725',
      externalReference: 'payer-1',
    });
    const payment = await client.createPayment({
      customer: 'cus_1',
      value: 350.5,
      dueDate: '2026-11-10',
      description: 'Mensalidade',
      externalReference: 'ref-1',
    });

    expect(customer.id).toBe('cus_1');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      customer: 'cus_1',
      billingType: 'BOLETO',
      value: 350.5,
      dueDate: '2026-11-10',
      description: 'Mensalidade',
      externalReference: 'ref-1',
    });
    expect(payment).toMatchObject({ id: 'pay_1', status: 'PENDING' });
    expect(logged.join('\n')).not.toContain('52998224725');
  });

  it('busca por externalReference usa a listagem e ignora cobrança removida', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, {
        object: 'list',
        data: [
          { id: 'pay_old', deleted: true, externalReference: 'ref-1' },
          { id: 'pay_ok', deleted: false, externalReference: 'ref-1' },
        ],
      }),
    );

    const found = await new AsaasClient(
      CONFIG,
      API_KEY,
      fetch,
    ).findPaymentByExternalReference('ref-1');

    expect(calls[0].url).toBe(
      'https://api-sandbox.asaas.com/v3/payments?externalReference=ref-1&limit=10',
    );
    expect(found?.id).toBe('pay_ok');
  });

  it('linha digitável, Pix e exclusão nos caminhos oficiais', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.url.endsWith('/identificationField')
        ? json(200, {
            identificationField: '2379...',
            nossoNumero: '123',
            barCode: '2379',
          })
        : call.url.endsWith('/pixQrCode')
          ? json(200, {
              payload: '000201',
              expirationDate: '2027-01-01 23:59:59',
            })
          : json(200, { deleted: true, id: 'pay_1' }),
    );
    const client = new AsaasClient(CONFIG, API_KEY, fetch);

    await expect(client.getIdentificationField('pay_1')).resolves.toEqual({
      identificationField: '2379...',
      nossoNumero: '123',
      barCode: '2379',
    });
    await expect(client.getPixQrCode('pay_1')).resolves.toEqual({
      payload: '000201',
      expirationDate: '2027-01-01 23:59:59',
    });
    await expect(client.deletePayment('pay_1')).resolves.toEqual({
      deleted: true,
    });
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      'GET https://api-sandbox.asaas.com/v3/payments/pay_1/identificationField',
      'GET https://api-sandbox.asaas.com/v3/payments/pay_1/pixQrCode',
      'DELETE https://api-sandbox.asaas.com/v3/payments/pay_1',
    ]);
  });

  it('cadastra o webhook com token, eventos e envio sequencial', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { id: 'wh_1' }));

    const result = await new AsaasClient(CONFIG, API_KEY, fetch).createWebhook({
      name: 'UniPass',
      url: 'https://api.exemplo.com/billing/webhook/asaas/abc',
      email: 'admin@exemplo.com',
      authToken: 'a'.repeat(48),
      events: ['PAYMENT_RECEIVED'],
    });
    const body = JSON.parse(calls[0].init.body as string) as Record<
      string,
      unknown
    >;

    expect(calls[0].url).toBe('https://api-sandbox.asaas.com/v3/webhooks');
    expect(calls[0].init.method).toBe('POST');
    expect(body).toMatchObject({
      authToken: 'a'.repeat(48),
      sendType: 'SEQUENTIALLY',
      enabled: true,
      interrupted: false,
      apiVersion: 3,
      events: ['PAYMENT_RECEIVED'],
    });
    expect(result.id).toBe('wh_1');
  });
});
