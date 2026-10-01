import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OpaqueIdService } from '../security/opaque-id.service';
import { JwtStrategy } from './jwt.strategy';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_A = '22222222-2222-4222-8222-222222222222';
const COMPANY_B = '33333333-3333-4333-8333-333333333333';

const userRecord = {
  id: USER_ID,
  email: 'admin@alfa.test',
  name: 'Admin Alfa',
  role: UserRole.ADMIN,
  active: true,
  companyId: COMPANY_A,
  company: { emailDomain: 'alfa.test', name: 'Transportes Alfa' },
};

function buildPrisma() {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(userRecord) },
  };
}

describe('JwtStrategy.validate', () => {
  const config = {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;
  const opaqueIds = new OpaqueIdService(config);
  let prisma: ReturnType<typeof buildPrisma>;
  let strategy: JwtStrategy;

  // Token assinado com a empresa B no payload, para um usuário que é da A.
  const tokenPayload = {
    sub: opaqueIds.encode(USER_ID) ?? undefined,
    companyId: opaqueIds.encode(COMPANY_B),
  };

  beforeEach(() => {
    prisma = buildPrisma();
    strategy = new JwtStrategy(
      config,
      prisma as unknown as PrismaService,
      opaqueIds,
    );
  });

  it('req.user.companyId vem do banco, não do companyId do token', async () => {
    const user = await strategy.validate(tokenPayload);

    expect(user.companyId).toBe(COMPANY_A);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
  });

  it('usuário sem empresa no banco (PLATFORM_ADMIN) fica com companyId null, nunca undefined', async () => {
    // No Prisma, `where: { companyId: undefined }` some com o filtro;
    // `null` filtra por "sem empresa".
    prisma.user.findUnique.mockResolvedValue({
      ...userRecord,
      role: UserRole.PLATFORM_ADMIN,
      companyId: null,
      company: null,
    });

    const user = await strategy.validate(tokenPayload);

    expect(user.companyId).toBeNull();
  });

  it('usuário desativado perde o acesso, mesmo com token válido', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...userRecord, active: false });

    await expect(strategy.validate(tokenPayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('usuário que não existe mais perde o acesso', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(tokenPayload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
