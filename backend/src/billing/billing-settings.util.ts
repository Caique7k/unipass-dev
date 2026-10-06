import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export function requireBillingCompanyId(companyId?: string | null) {
  if (!companyId) {
    throw new BadRequestException(
      'Este usuario nao esta vinculado a uma empresa.',
    );
  }

  return companyId;
}

/** Configuração financeira da empresa, criada vazia (EXTERNAL) se faltar. */
export async function ensureCompanyBillingSettings(
  prisma: PrismaService,
  companyId: string,
) {
  const company = await prisma.company.findUnique({
    where: {
      id: companyId,
    },
    select: {
      id: true,
    },
  });

  if (!company) {
    throw new BadRequestException(
      'Empresa nao encontrada para o modulo financeiro.',
    );
  }

  return prisma.companyBillingSettings.upsert({
    where: {
      companyId,
    },
    update: {},
    create: {
      companyId,
    },
  });
}
