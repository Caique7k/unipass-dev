import { PrismaService } from 'src/prisma/prisma.service';
import { StudentsService } from 'src/students/students.service';
import { UsersService } from 'src/users/users.service';

/**
 * Os services reais, com o Prisma do banco de teste (sem TestingModule).
 * Cada módulo coberto pelos testes de isolamento entra aqui.
 */
export function buildServices(prisma: PrismaService) {
  return {
    students: new StudentsService(prisma),
    users: new UsersService(prisma),
  };
}

export type TenantServices = ReturnType<typeof buildServices>;
