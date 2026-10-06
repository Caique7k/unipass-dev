import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { RequestMethod, Type } from '@nestjs/common';
import {
  CONTROLLER_WATERMARK,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';

/**
 * Guarda estrutural do isolamento entre empresas: o `companyId` de toda
 * consulta vem de `req.user` (carregado do banco pelo JwtStrategy), nunca da
 * tela. Este teste varre todas as rotas — inclusive as que forem criadas
 * depois — e falha se alguma abrir caminho para o cliente mandar o `companyId`.
 */

// Rotas que recebem o corpo sem DTO, de propósito. Cada uma precisa continuar
// pública: sem usuário logado, não existe empresa para trocar.
const ROUTES_WITHOUT_DTO: Record<string, string> = {
  'POST /billing/webhook/asaas':
    'webhook do ASAAS (rota legada): payload livre do Asaas; valida ASAAS_WEBHOOK_TOKEN + IP em billing-webhook.service.ts',
  'POST /billing/webhook/asaas/:endpointKey':
    'webhook do ASAAS por empresa: payload livre do Asaas; a empresa vem da endpointKey (DTO) e o token é conferido contra o hash salvo em billing-webhook.service.ts',
};

const CLIENT_INPUTS: Partial<Record<RouteParamtypes, string>> = {
  [RouteParamtypes.BODY]: '@Body',
  [RouteParamtypes.QUERY]: '@Query',
  [RouteParamtypes.PARAM]: '@Param',
  [RouteParamtypes.HEADERS]: '@Headers',
};
const COMPANY_ID_NAME = /company[-_]?id/i;
const NOT_A_DTO: unknown[] = [
  undefined,
  Object,
  String,
  Number,
  Boolean,
  Array,
];
// Ler req.body/req.query/req.params direto pula o DTO e o ValidationPipe.
const RAW_REQUEST_INPUT = /\b(?:req|request)\.(?:body|query|params)\b/;

type RouteArg = {
  type: RouteParamtypes;
  index: number;
  data: unknown;
  metatype: unknown;
};

type Route = {
  label: string;
  handler: (...args: unknown[]) => unknown;
  isPublic: boolean;
  args: RouteArg[];
};

const SRC_DIR = join(__dirname, '..');

function controllerFiles() {
  return readdirSync(SRC_DIR, { encoding: 'utf8', recursive: true })
    .filter((file) => file.endsWith('.controller.ts'))
    .sort();
}

function isController(value: unknown): value is Type {
  return (
    typeof value === 'function' &&
    Reflect.getMetadata(CONTROLLER_WATERMARK, value) === true
  );
}

function controllersIn(file: string) {
  const exported = jest.requireActual<Record<string, unknown>>(
    join(SRC_DIR, file),
  );

  return Object.values(exported).filter(isController);
}

function firstPath(metadata: unknown) {
  const path = Array.isArray(metadata) ? (metadata[0] as unknown) : metadata;

  return typeof path === 'string' ? path : '';
}

function routeLabel(method: RequestMethod, prefix: string, path: string) {
  const fullPath = [prefix, path]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return `${RequestMethod[method]} /${fullPath}`;
}

function routesOf(controller: Type): Route[] {
  const prototype = controller.prototype as Record<string, unknown>;
  const prefix = firstPath(Reflect.getMetadata(PATH_METADATA, controller));
  const controllerIsPublic =
    Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;

  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];

    if (name === 'constructor' || typeof handler !== 'function') {
      return [];
    }

    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      | RequestMethod
      | undefined;

    if (method === undefined) {
      return [];
    }

    const argsMetadata = (Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      controller,
      name,
    ) ?? {}) as Record<string, { index: number; data?: unknown }>;
    const paramTypes = (Reflect.getMetadata(
      'design:paramtypes',
      prototype,
      name,
    ) ?? []) as unknown[];

    return [
      {
        label: routeLabel(
          method,
          prefix,
          firstPath(Reflect.getMetadata(PATH_METADATA, handler)),
        ),
        handler: handler as (...args: unknown[]) => unknown,
        isPublic:
          controllerIsPublic ||
          Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        args: Object.entries(argsMetadata).map(([key, arg]) => ({
          // A chave é "<tipo>:<posição>"; decorators customizados não têm tipo numérico.
          type: Number(key.split(':')[0]) as RouteParamtypes,
          index: arg.index,
          data: arg.data,
          metatype: paramTypes[arg.index],
        })),
      },
    ];
  });
}

async function acceptsCompanyId(dto: ClassConstructor<object>) {
  // Mesmas opções do ValidationPipe global em main.ts.
  const errors = await validate(
    plainToInstance(dto, { companyId: '11111111-1111-4111-8111-111111111111' }),
    { whitelist: true, forbidNonWhitelisted: true },
  );

  return !errors.some(
    (error) =>
      error.property === 'companyId' &&
      Boolean(error.constraints?.whitelistValidation),
  );
}

describe('Isolamento entre empresas — companyId nunca vem da requisição', () => {
  const files = controllerFiles();
  const routes = files.flatMap((file) =>
    controllersIn(file).flatMap((controller) => routesOf(controller)),
  );

  it('encontra todos os controllers e suas rotas', () => {
    const filesWithoutController = files.filter(
      (file) => controllersIn(file).length === 0,
    );

    expect(filesWithoutController).toEqual([]);
    expect(routes.map((route) => route.label)).toEqual(
      expect.arrayContaining([
        'GET /students/:id',
        'POST /rfid/link',
        'GET /dashboard/reports',
        'POST /iot/rfid/read',
        'POST /billing/webhook/asaas',
      ]),
    );
  });

  it('nenhum parâmetro, query, corpo ou header se chama companyId', () => {
    const violations = routes.flatMap((route) =>
      route.args
        .filter(
          (arg) =>
            CLIENT_INPUTS[arg.type] !== undefined &&
            typeof arg.data === 'string' &&
            COMPANY_ID_NAME.test(arg.data),
        )
        .map(
          (arg) =>
            `${route.label}: ${CLIENT_INPUTS[arg.type]}('${String(arg.data)}')`,
        ),
    );

    expect(violations).toEqual([]);
  });

  it('todo @Body()/@Query()/@Param() inteiro usa um DTO que recusa companyId', async () => {
    const violations: string[] = [];

    for (const route of routes) {
      for (const arg of route.args) {
        const isWholeInput =
          (arg.type === RouteParamtypes.BODY ||
            arg.type === RouteParamtypes.QUERY ||
            arg.type === RouteParamtypes.PARAM) &&
          arg.data === undefined;

        if (!isWholeInput) {
          continue;
        }

        if (NOT_A_DTO.includes(arg.metatype)) {
          if (!(route.label in ROUTES_WITHOUT_DTO)) {
            violations.push(
              `${route.label}: ${CLIENT_INPUTS[arg.type]}() sem classe DTO`,
            );
          }
          continue;
        }

        const dto = arg.metatype as ClassConstructor<object>;

        if (await acceptsCompanyId(dto)) {
          violations.push(`${route.label}: ${dto.name} aceita companyId`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('nenhum handler lê req.body, req.query ou req.params direto', () => {
    const violations = routes
      .filter((route) => RAW_REQUEST_INPUT.test(String(route.handler)))
      .map((route) => route.label);

    expect(violations).toEqual([]);
  });

  it('as rotas sem DTO continuam existindo e continuam públicas', () => {
    for (const label of Object.keys(ROUTES_WITHOUT_DTO)) {
      const route = routes.find((candidate) => candidate.label === label);

      expect(route?.isPublic).toBe(true);
    }
  });
});
