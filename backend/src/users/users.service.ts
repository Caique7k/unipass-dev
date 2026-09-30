import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const userStudentSelect = {
  id: true,
  name: true,
  email: true,
  registration: true,
  active: true,
} satisfies Prisma.StudentSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    currentUser: {
      role: UserRole;
      companyId?: string | null;
    },
    options?: {
      search?: string;
      active?: boolean;
      role?: string;
      page?: number;
      limit?: number;
    },
  ) {
    if (!currentUser.companyId) {
      return { data: [], total: 0, page: 1, lastPage: 1 };
    }

    const page = options?.page && options.page > 0 ? options.page : 1;
    const limit = options?.limit && options.limit > 0 ? options.limit : 10;
    const search = options?.search?.trim();
    const active = options?.active;
    const skip = (page - 1) * limit;
    const normalizedRole = search ? this.normalizeRoleSearch(search) : undefined;
    const selectedRole = options?.role
      ? this.normalizeRoleSearch(options.role)
      : undefined;
    const where: Prisma.UserWhereInput = {
      companyId: currentUser.companyId,
      role: {
        not: UserRole.PLATFORM_ADMIN,
      },
      ...(active !== undefined ? { active } : {}),
      ...(selectedRole ? { role: selectedRole } : {}),
      ...(search
        ? {
            OR: [
              {
                name: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              ...(normalizedRole
                ? [
                    {
                      role: {
                        equals: normalizedRole,
                      },
                    },
                  ]
                : []),
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          studentId: true,
          student: {
            select: userStudentSelect,
          },
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async create(
    currentUser: { companyId?: string | null },
    dto: CreateUserDto,
  ) {
    const company = await this.getCompanyOrFail(currentUser.companyId);

    this.validateCompanyRole(dto.role);

    const identity = await this.resolveUserIdentity(
      company.id,
      company.emailDomain,
      dto,
    );

    await this.ensureCompanyEmailAvailability(identity.email, company.id);

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    try {
      return await this.prisma.user.create({
        data: {
          companyId: company.id,
          studentId: identity.studentId,
          name: identity.name,
          email: identity.email,
          password: hashedPassword,
          role: dto.role,
          active: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          studentId: true,
          student: {
            select: userStudentSelect,
          },
          createdAt: true,
        },
      });
    } catch (error) {
      this.handleUniqueEmail(error);
    }
  }

  async update(
    currentUser: { id: string; companyId?: string | null },
    id: string,
    dto: UpdateUserDto,
  ) {
    if (dto.active === false) {
      this.ensureNotDeactivatingSelf(currentUser.id, [id]);
    }

    const company = await this.getCompanyOrFail(currentUser.companyId);

    const user = await this.prisma.user.findFirst({
      where: {
        id,
        companyId: company.id,
        role: {
          not: UserRole.PLATFORM_ADMIN,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const nextRole = dto.role ?? user.role;
    this.validateCompanyRole(nextRole);

    const identity = await this.resolveUserIdentity(
      company.id,
      company.emailDomain,
      {
        name: dto.name ?? user.name,
        email: dto.email ?? user.email,
        studentId: dto.studentId ?? user.studentId ?? undefined,
        role: nextRole,
      },
      user.id,
    );

    await this.ensureCompanyEmailAvailability(identity.email, company.id, user.id);

    const data: Prisma.UserUpdateInput = {
      name: identity.name,
      email: identity.email,
      role: nextRole,
      active: dto.active ?? user.active,
      student: identity.studentId
        ? {
            connect: {
              id: identity.studentId,
            },
          }
        : user.studentId
          ? {
              disconnect: true,
            }
          : undefined,
    };

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          studentId: true,
          student: {
            select: userStudentSelect,
          },
          createdAt: true,
        },
      });
    } catch (error) {
      this.handleUniqueEmail(error);
    }
  }

  async deactivateMany(
    currentUser: { id: string; companyId?: string | null },
    ids: string[],
  ) {
    this.ensureNotDeactivatingSelf(currentUser.id, ids);

    const company = await this.getCompanyOrFail(currentUser.companyId);

    const result = await this.prisma.user.updateMany({
      where: {
        id: {
          in: ids,
        },
        companyId: company.id,
        role: {
          not: UserRole.PLATFORM_ADMIN,
        },
      },
      data: {
        active: false,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Nenhum usuário encontrado para desativar.');
    }

    return result;
  }

  private async getCompanyOrFail(companyId?: string | null) {
    if (!companyId) {
      throw new BadRequestException('Usuário sem empresa vinculada.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Empresa não encontrada.');
    }

    return company;
  }

  private validateCompanyRole(role: UserRole) {
    if (role === UserRole.PLATFORM_ADMIN) {
      throw new BadRequestException('Esse perfil so pode ser criado na plataforma');
    }
  }

  // Usuário inativo perde o acesso na próxima requisição (JwtStrategy); se fosse
  // o único ADMIN da empresa, ninguém conseguiria reativá-lo pela API.
  // Compara sem diferenciar maiúsculas porque a API também aceita UUID cru.
  private ensureNotDeactivatingSelf(currentUserId: string, ids: string[]) {
    const ownId = currentUserId.toLowerCase();

    if (ids.some((id) => id.toLowerCase() === ownId)) {
      throw new BadRequestException(
        'Você não pode desativar a sua própria conta. Peça a outro administrador da empresa para fazer isso.',
      );
    }
  }

  private async resolveUserIdentity(
    companyId: string,
    companyDomain: string,
    dto: {
      name?: string;
      email?: string;
      studentId?: string;
      role: UserRole;
    },
    currentUserId?: string,
  ) {
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          companyId,
        },
        include: {
          user: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!student) {
        throw new BadRequestException('Aluno não encontrado para esta empresa.');
      }

      if (!student.email) {
        throw new BadRequestException(
          'O aluno selecionado precisa ter um e-mail antes de criar o usuário.',
        );
      }

      if (student.user && student.user.id !== currentUserId) {
        throw new BadRequestException('Este aluno já possui um usuário vinculado.');
      }

      return {
        name: student.name,
        email: this.normalizeCompanyEmail(student.email, companyDomain),
        studentId: student.id,
      };
    }

    if (dto.role === UserRole.USER) {
      throw new BadRequestException(
        'Para criar um usuário de aluno, selecione um aluno já cadastrado.',
      );
    }

    if (!dto.name?.trim()) {
      throw new BadRequestException('Informe o nome do usuário.');
    }

    if (!dto.email?.trim()) {
      throw new BadRequestException('Informe o e-mail do usuário.');
    }

    return {
      name: dto.name.trim(),
      email: this.normalizeCompanyEmail(dto.email, companyDomain),
      studentId: undefined,
    };
  }

  private normalizeCompanyEmail(email: string, domain: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const expectedSuffix = `@${domain.toLowerCase()}`;
    const emailPattern =
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*@[a-z0-9.-]+\.[a-z]{2,}$/;

    if (!normalizedEmail.endsWith(expectedSuffix)) {
      throw new BadRequestException(
        `O e-mail deve usar o domínio da empresa (${expectedSuffix}).`,
      );
    }

    if (!emailPattern.test(normalizedEmail)) {
      throw new BadRequestException(
        'Use o formato nome.sobrenome@dominio-da-empresa.',
      );
    }

    return normalizedEmail;
  }

  private async ensureCompanyEmailAvailability(
    email: string,
    companyId: string,
    currentUserId?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findFirst({
      where: {
        companyId,
        email: normalizedEmail,
        ...(currentUserId
          ? {
              id: {
                not: currentUserId,
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    if (existingUser) {
      throw new BadRequestException(
        'Já existe um usuário com esse nome de login neste domínio.',
      );
    }
  }

  private normalizeRoleSearch(search: string): UserRole | undefined {
    const normalized = search.trim().toUpperCase();

    if (
      normalized === 'ADMIN' ||
      normalized === 'DRIVER' ||
      normalized === 'USER' ||
      normalized === 'COORDINATOR' ||
      normalized === 'PLATFORM_ADMIN'
    ) {
      return normalized as UserRole;
    }

    return undefined;
  }

  private handleUniqueEmail(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException('E-mail já cadastrado.');
    }

    throw error;
  }
}
