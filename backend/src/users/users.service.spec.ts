import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
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

const adminRecord = {
  id: admin.id,
  name: 'Admin Horizonte',
  email: 'admin@horizonte.edu.br',
  role: UserRole.ADMIN,
  active: true,
  studentId: null,
  companyId: COMPANY.id,
};
const driverRecord = {
  ...adminRecord,
  id: OTHER_USER_ID,
  name: 'Motorista Horizonte',
  email: 'motorista@horizonte.edu.br',
  role: UserRole.DRIVER,
};

function buildPrisma() {
  return {
    company: { findUnique: jest.fn().mockResolvedValue(COMPANY) },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      // 1ª chamada: o usuário editado; as seguintes: checagem de e-mail livre.
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
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

  describe('update', () => {
    const lastUpdateArgs = () =>
      prisma.user.update.mock.lastCall as [Prisma.UserUpdateArgs];

    it('recusa active: false na própria conta, sem tocar no banco', async () => {
      const attempt = service.update(admin, admin.id, { active: false });

      await expect(attempt).rejects.toThrow(BadRequestException);
      await expect(attempt).rejects.toThrow('própria conta');
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('permite editar a própria conta sem desativá-la', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(adminRecord);

      await service.update(admin, admin.id, { name: 'Admin Novo Nome' });

      const [args] = lastUpdateArgs();
      expect(args.where).toEqual({ id: admin.id });
      expect(args.data).toMatchObject({
        name: 'Admin Novo Nome',
        active: true,
      });
    });

    it('permite desativar outro usuário pelo update', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(driverRecord);

      await service.update(admin, OTHER_USER_ID, { active: false });

      const [args] = lastUpdateArgs();
      expect(args.where).toEqual({ id: OTHER_USER_ID });
      expect(args.data).toMatchObject({ active: false });
    });
  });
});
