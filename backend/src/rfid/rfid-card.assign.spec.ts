import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assignRfidTagToStudent } from './rfid-card.assign';

const COMPANY = 'company-1';

function buildDb(existing: unknown) {
  return {
    rfidCard: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: 'new-card' }),
      update: jest.fn().mockResolvedValue({ id: 'card-1' }),
    },
  };
}

const assign = (db: ReturnType<typeof buildDb>) =>
  assignRfidTagToStudent(db as unknown as Prisma.TransactionClient, {
    companyId: COMPANY,
    studentId: 'student-new',
    tag: 'F3ED4C1C',
  });

const card = (overrides: object) => ({
  id: 'card-1',
  companyId: COMPANY,
  active: true,
  student: { active: true, name: 'Ana' },
  ...overrides,
});

describe('assignRfidTagToStudent', () => {
  it('TAG nova é criada', async () => {
    const db = buildDb(null);
    await assign(db);
    expect(db.rfidCard.create).toHaveBeenCalled();
  });

  it.each([
    ['TAG desativada', card({ active: false })],
    ['TAG de aluno inativo', card({ student: { active: false, name: 'Ana' } })],
    ['TAG sem aluno', card({ student: null })],
  ])('%s é reaproveitada para o novo aluno', async (_label, existing) => {
    const db = buildDb(existing);
    await assign(db);
    expect(db.rfidCard.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { studentId: 'student-new', active: true },
    });
    expect(db.rfidCard.create).not.toHaveBeenCalled();
  });

  it('mesma TAG já ativa no mesmo aluno não dá erro', async () => {
    const db = buildDb(card({ studentId: 'student-new' }));
    await expect(assign(db)).resolves.toMatchObject({ id: 'card-1' });
    expect(db.rfidCard.update).not.toHaveBeenCalled();
  });

  it('TAG em uso por aluno ativo é recusada com o nome do aluno', async () => {
    const db = buildDb(card({}));
    await expect(assign(db)).rejects.toThrow('TAG já vinculada ao aluno Ana.');
    expect(db.rfidCard.update).not.toHaveBeenCalled();
  });

  it('TAG de outra empresa nunca é reaproveitada, nem com aluno inativo', async () => {
    const db = buildDb(
      card({ companyId: 'other', active: false, student: null }),
    );
    await expect(assign(db)).rejects.toThrow(BadRequestException);
    await expect(assign(db)).rejects.toThrow('TAG já cadastrada');
  });
});
