import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

type ExistingCard = {
  companyId: string;
  active: boolean;
  student: { active: boolean; name: string } | null;
};

/**
 * TAG física pode trocar de dono: quando o aluno é desativado, a TAG dele é
 * desativada junto e pode ser vinculada a outro aluno da mesma empresa.
 * Está "livre" se a TAG estiver inativa, sem aluno ou com aluno inativo.
 */
export function isRfidCardReusable(card: ExistingCard, companyId: string) {
  return (
    card.companyId === companyId &&
    (!card.active || !card.student || !card.student.active)
  );
}

/**
 * Vincula `tag` (já normalizada) ao aluno. Reaproveita a linha do RfidCard
 * quando a TAG está livre — o histórico não se mistura, porque cada
 * TransportEvent guarda o próprio studentId.
 */
export async function assignRfidTagToStudent(
  db: Db,
  params: { companyId: string; studentId: string; tag: string },
) {
  const { companyId, studentId, tag } = params;
  const existing = await db.rfidCard.findUnique({
    where: { tag },
    include: { student: { select: { active: true, name: true } } },
  });

  if (!existing) {
    return db.rfidCard.create({
      data: { tag, studentId, companyId },
    });
  }

  // Mesma TAG, mesmo aluno, já ativa: nada a fazer.
  if (existing.studentId === studentId && existing.active) {
    return existing;
  }

  if (!isRfidCardReusable(existing, companyId)) {
    throw new BadRequestException(
      existing.companyId === companyId && existing.student
        ? `TAG já vinculada ao aluno ${existing.student.name}.`
        : 'TAG já cadastrada',
    );
  }

  return db.rfidCard.update({
    where: { id: existing.id },
    data: { studentId, active: true },
  });
}

/** Desativa as TAGs dos alunos informados (chamado ao desativar alunos). */
export function releaseStudentsRfidCards(
  db: Db,
  companyId: string,
  studentIds: string[],
) {
  return db.rfidCard.updateMany({
    where: { companyId, studentId: { in: studentIds }, active: true },
    data: { active: false },
  });
}
