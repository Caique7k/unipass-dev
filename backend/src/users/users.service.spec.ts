import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const COMPANY = { id: 'company-1', emailDomain: 'horizonte.edu.br' };
// Usuário logado, no formato que o JwtStrategy entrega em req.user.
const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  companyId: COMPANY.id,
};
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ANOTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

function buildPrisma() {
  return {
    company: { findUnique: jest.fn().mockResolvedValue(COMPANY) },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('UsersService', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: UsersService;

  beforeEach(() => {
    prisma = buildPrisma();
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('deactivateMany', () => {
    it('recusa desativar a própria conta, sem tocar no banco', async () => {
      const attempt = service.deactivateMany(admin, [admin.id]);

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow('própria conta');
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('recusa a lista inteira quando a própria conta vem junto com outras', async () => {
      await expect(
        service.deactivateMany(admin, [OTHER_USER_ID, admin.id]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('reconhece a própria conta mesmo com o id em maiúsculas', async () => {
      await expect(
        service.deactivateMany(admin, [admin.id.toUpperCase()]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('desativa outros usuários, filtrando pela empresa do usuário logado', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        service.deactivateMany(admin, [OTHER_USER_ID, ANOTHER_USER_ID]),
      ).resolves.toEqual({ count: 2 });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [OTHER_USER_ID, ANOTHER_USER_ID] },
          companyId: COMPANY.id,
          role: { not: UserRole.PLATFORM_ADMIN },
        },
        data: { active: false },
      });
    });

    it('mantém o 404 quando nenhum usuário da empresa é encontrado', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deactivateMany(admin, [OTHER_USER_ID]),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
