import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { OpaqueIdService } from '../security/opaque-id.service';
import { AuthService } from './auth.service';
import { PASSWORD_HASH_ROUNDS, hashPassword } from './password-hash.util';

// bcrypt de verdade, com compare e hash espionados para contar as chamadas
// (passem elas pelo password-hash.util ou não).
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof bcrypt>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((data: string, hash: string) =>
      actual.compare(data, hash),
    ),
    hash: jest.fn((data: string, rounds: number) => actual.hash(data, rounds)),
  };
});

const compareMock = bcrypt.compare as unknown as jest.Mock<
  Promise<boolean>,
  [string, string]
>;
const hashMock = bcrypt.hash as unknown as jest.Mock<
  Promise<string>,
  [string, number]
>;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN_EXP = 1_900_000_000; // exp (em segundos) do token assinado
const RIGHT_PASSWORD = 'senha-certa-123';
const WRONG_PASSWORD = 'senha-errada-456';
const INVALID_CREDENTIALS = {
  statusCode: 401,
  message: 'Invalid credentials',
  error: 'Unauthorized',
};

let userHash: string;

function userRecord(overrides: { active?: boolean } = {}) {
  return {
    id: USER_ID,
    email: 'admin@alfa.test',
    name: 'Admin Alfa',
    role: UserRole.ADMIN,
    active: true,
    companyId: COMPANY_ID,
    password: userHash,
    company: { emailDomain: 'alfa.test', name: 'Transportes Alfa' },
    ...overrides,
  };
}

function buildPrisma() {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(userRecord()) },
  };
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as UnauthorizedException;
  }
  throw new Error('o login deveria ter sido recusado');
}

describe('AuthService.login', () => {
  const settings: Record<string, string> = {
    JWT_EXPIRES: '1h',
    JWT_REMEMBER_EXPIRES: '30d',
  };
  const config = {
    get: jest.fn((key: string) => settings[key]),
  } as unknown as ConfigService;
  const opaqueIds = {
    encode: jest.fn((value: string | null) => (value ? `opk_${value}` : null)),
  };
  let prisma: ReturnType<typeof buildPrisma>;
  let jwt: { sign: jest.Mock; decode: jest.Mock };
  let service: AuthService;

  beforeAll(async () => {
    userHash = await hashPassword(RIGHT_PASSWORD);
  });

  beforeEach(() => {
    compareMock.mockClear();
    hashMock.mockClear();
    prisma = buildPrisma();
    jwt = {
      sign: jest.fn().mockReturnValue('jwt-assinado'),
      decode: jest.fn().mockReturnValue({ exp: TOKEN_EXP }),
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      config,
      opaqueIds as unknown as OpaqueIdService,
    );
  });

  it.each([
    ['e-mail inexistente', null],
    ['usuário inativo com senha errada', { active: false }],
    ['usuário ativo com senha errada', { active: true }],
  ] as const)(
    '%s: 401 igual aos outros e exatamente um bcrypt.compare',
    async (_case, state) => {
      prisma.user.findUnique.mockResolvedValue(
        state ? userRecord(state) : null,
      );

      const error = await rejectionOf(
        service.login('alguem@alfa.test', WRONG_PASSWORD),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toEqual(INVALID_CREDENTIALS);
      expect(compareMock).toHaveBeenCalledTimes(1);
      expect(compareMock.mock.calls[0][0]).toBe(WRONG_PASSWORD);
      if (state) {
        expect(compareMock.mock.calls[0][1]).toBe(userHash);
      }
      expect(jwt.sign).not.toHaveBeenCalled();
    },
  );

  it('e-mail inexistente compara com um hash falso do mesmo custo dos hashes reais, gerado uma vez', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await rejectionOf(service.login('ninguem@alfa.test', WRONG_PASSWORD));
    await rejectionOf(service.login('outro@alfa.test', WRONG_PASSWORD));

    const [first, second] = compareMock.mock.calls.map(([, hash]) => hash);
    expect(first).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.getRounds(first)).toBe(PASSWORD_HASH_ROUNDS);
    expect(bcrypt.getRounds(first)).toBe(bcrypt.getRounds(userHash));
    expect(first).not.toBe(userHash);
    expect(second).toBe(first);
  });

  it('o hash falso fica pronto na subida (onModuleInit): o login não gera outro', async () => {
    await service.onModuleInit();
    expect(hashMock).toHaveBeenCalledTimes(1);
    expect(hashMock.mock.calls[0][1]).toBe(PASSWORD_HASH_ROUNDS);

    prisma.user.findUnique.mockResolvedValue(null);
    await rejectionOf(service.login('ninguem@alfa.test', WRONG_PASSWORD));

    expect(hashMock).toHaveBeenCalledTimes(1);
    expect(compareMock).toHaveBeenCalledTimes(1);
  });

  it('e-mail inexistente com uma senha que bate com o hash falso continua 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    compareMock.mockResolvedValueOnce(true);

    const error = await rejectionOf(
      service.login('ninguem@alfa.test', 'qualquer'),
    );

    expect(error.getResponse()).toEqual(INVALID_CREDENTIALS);
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('usuário inativo com a senha certa continua 401', async () => {
    prisma.user.findUnique.mockResolvedValue(userRecord({ active: false }));

    const error = await rejectionOf(
      service.login('admin@alfa.test', RIGHT_PASSWORD),
    );

    expect(error.getResponse()).toEqual(INVALID_CREDENTIALS);
    expect(compareMock).toHaveBeenCalledTimes(1);
    // A senha bateu de verdade: quem recusou foi o "inativo".
    await expect(compareMock.mock.results[0].value).resolves.toBe(true);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('login correto devolve o token e o vencimento dele, com ids opacos no payload e expiração de 1h', async () => {
    const result = await service.login('admin@alfa.test', RIGHT_PASSWORD);

    // O vencimento vem do exp do próprio token assinado.
    expect(result).toEqual({
      access_token: 'jwt-assinado',
      expiresAt: new Date(TOKEN_EXP * 1000),
    });
    expect(jwt.decode).toHaveBeenCalledWith('jwt-assinado');
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        sub: `opk_${USER_ID}`,
        email: 'admin@alfa.test',
        name: 'Admin Alfa',
        role: UserRole.ADMIN,
        companyId: `opk_${COMPANY_ID}`,
        emailDomain: 'alfa.test',
        companyName: 'Transportes Alfa',
      },
      { expiresIn: '1h' },
    );
  });

  it('rememberMe muda a expiração para 30d', async () => {
    await service.login('admin@alfa.test', RIGHT_PASSWORD, true);

    expect(jwt.sign).toHaveBeenCalledWith(expect.any(Object), {
      expiresIn: '30d',
    });
  });
});
