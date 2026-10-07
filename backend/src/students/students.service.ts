import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingTargetScope, Prisma } from '@prisma/client';
import {
  BillingEncryptionKeyError,
  parseEncryptionKey,
} from '../billing/billing-crypto.util';
import {
  InvalidDocumentError,
  normalizeCpfCnpj,
  protectDocument,
} from '../billing/billing-document.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { StudentBillingCustomerDto } from './dto/student-billing-customer.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { requireRfidTag } from '../rfid/rfid-tag.util';
import {
  assignRfidTagToStudent,
  releaseStudentsRfidCards,
} from '../rfid/rfid-card.assign';

const studentDetailsInclude = {
  rfidCards: true,
  group: {
    select: {
      id: true,
      name: true,
      active: true,
    },
  },
  billingTemplate: {
    select: {
      id: true,
      name: true,
      active: true,
      amountCents: true,
      dueDay: true,
      recurrence: true,
    },
  },
  billingCustomers: {
    // Documento só mascarado: o CPF/CNPJ completo nunca sai da API.
    select: {
      id: true,
      name: true,
      email: true,
      documentMasked: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
  routes: {
    select: {
      route: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  },
} satisfies Prisma.StudentInclude;

type StudentWithDetails = Prisma.StudentGetPayload<{
  include: typeof studentDetailsInclude;
}>;

type StudentResponse = Omit<StudentWithDetails, 'billingCustomers'> & {
  billingCustomer:
    | (StudentWithDetails['billingCustomers'][number] & {
        hasDocument: boolean;
      })
    | null;
};

@Injectable()
export class StudentsService {
  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll({
    companyId,
    page,
    limit,
    search,
    active,
  }: {
    companyId: string;
    page: number;
    limit: number;
    search?: string;
    active?: boolean;
  }) {
    const skip = (page - 1) * limit;

    const where: Prisma.StudentWhereInput = {
      companyId,
      ...(search && {
        OR: [
          {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
          {
            registration: {
              contains: search,
              mode: 'insensitive',
            },
          },
        ],
      }),
      ...(active !== undefined && {
        active,
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: studentDetailsInclude,
      }),
      this.prisma.student.count({ where }),
    ]);

    return {
      data: data.map((student) => this.mapStudent(student)),
      total,
      page,
      lastPage: limit > 0 ? Math.ceil(total / limit) : 1,
    };
  }

  async findOne(companyId: string, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, companyId },
      include: studentDetailsInclude,
    });

    if (!student) throw new NotFoundException('Aluno nao encontrado');

    return this.mapStudent(student);
  }

  async create(companyId: string, dto: CreateStudentDto) {
    const company = await this.getCompanyOrFail(companyId);
    const group = await this.getAssignableGroupOrFail(companyId, dto.groupId);
    const billingTemplate = await this.getAssignableBillingTemplateOrFail(
      companyId,
      dto.billingTemplateId,
    );
    const routeIds = await this.getAssignableRouteIdsOrFail(
      companyId,
      dto.routeIds,
    );
    const normalizedEmail = this.normalizeStudentEmail(
      dto.email,
      company.emailDomain,
    );

    const rfidTag = dto.rfidTag ? requireRfidTag(dto.rfidTag) : null;

    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.student.findFirst({
        where: {
          companyId,
          registration: dto.registration,
        },
      });

      if (exists) {
        throw new BadRequestException('Matricula ja cadastrada');
      }

      let student;

      try {
        student = await tx.student.create({
          data: {
            companyId,
            groupId: group.id,
            billingTemplateId: billingTemplate.id,
            name: dto.name,
            registration: dto.registration,
            active: dto.active ?? true,
            email: normalizedEmail,
            phone: dto.phone ?? null,
            routes: {
              createMany: {
                data: routeIds.map((routeId) => ({ routeId })),
              },
            },
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException(
            normalizedEmail
              ? 'Ja existe um aluno com esse e-mail neste dominio.'
              : 'Matricula ja cadastrada.',
          );
        }

        throw error;
      }

      if (rfidTag) {
        await assignRfidTagToStudent(tx, {
          companyId,
          studentId: student.id,
          tag: rfidTag,
        });
      }

      await this.syncBillingCustomer(tx, {
        companyId,
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email,
        studentPhone: student.phone,
        billingCustomer: dto.billingCustomer,
      });

      const createdStudent = await tx.student.findUniqueOrThrow({
        where: { id: student.id },
        include: studentDetailsInclude,
      });

      return this.mapStudent(createdStudent);
    });
  }

  async update(companyId: string, id: string, dto: UpdateStudentDto) {
    const student = await this.findOne(companyId, id);
    const company = await this.getCompanyOrFail(companyId);
    const nextGroupId =
      dto.groupId === undefined
        ? student.groupId
        : await this.resolveNextGroupId(companyId, student, dto.groupId);
    const nextBillingTemplateId =
      dto.billingTemplateId === undefined
        ? student.billingTemplateId
        : await this.resolveNextBillingTemplateId(
            companyId,
            student,
            dto.billingTemplateId,
          );
    const nextRouteIds =
      dto.routeIds === undefined
        ? student.routes.map((studentRoute) => studentRoute.route.id)
        : await this.getAssignableRouteIdsOrFail(companyId, dto.routeIds, {
            allowCurrentStudentId: id,
          });
    const nextEmail =
      dto.email !== undefined
        ? this.normalizeStudentEmail(dto.email, company.emailDomain)
        : student.email;
    const nextName = dto.name ?? student.name;
    const nextActive = dto.active ?? student.active;
    const nextPhone = dto.phone ?? student.phone;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.student.update({
          where: { id },
          data: {
            name: nextName,
            registration: dto.registration ?? student.registration,
            active: nextActive,
            groupId: nextGroupId,
            billingTemplateId: nextBillingTemplateId,
            email: nextEmail,
            phone: nextPhone,
          },
        });

        if (student.active && !nextActive) {
          await releaseStudentsRfidCards(tx, companyId, [id]);
        }

        await tx.studentRoute.deleteMany({
          where: {
            studentId: id,
          },
        });

        await tx.studentRoute.createMany({
          data: nextRouteIds.map((routeId) => ({
            studentId: id,
            routeId,
          })),
        });

        await this.syncBillingCustomer(tx, {
          companyId,
          studentId: id,
          studentName: nextName,
          studentEmail: nextEmail,
          studentPhone: nextPhone,
          billingCustomer: dto.billingCustomer,
        });

        const updatedStudent = await tx.student.findUniqueOrThrow({
          where: { id },
          include: studentDetailsInclude,
        });

        return this.mapStudent(updatedStudent);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Matricula ja cadastrada');
      }

      throw error;
    }
  }

  async deleteMany(companyId: string, ids: string[]) {
    return this.prisma.student.deleteMany({
      where: {
        companyId,
        id: {
          in: ids,
        },
      },
    });
  }

  // Desativar o aluno libera a TAG dele para ser vinculada a outro aluno.
  // Reativar o aluno NÃO devolve a TAG (ela pode já estar com outra pessoa).
  async desactivateMany(companyId: string, ids: string[]) {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.student.updateMany({
        where: {
          companyId,
          id: {
            in: ids,
          },
        },
        data: {
          active: false,
        },
      });

      await releaseStudentsRfidCards(tx, companyId, ids);

      return updated;
    });

    if (result.count === 0) {
      throw new NotFoundException('Nenhum aluno encontrado para desativar.');
    }

    return result;
  }

  async findUserCandidates(companyId: string, includeUserId?: string) {
    return this.prisma.student.findMany({
      where: {
        companyId,
        OR: [
          {
            active: true,
            email: {
              not: null,
            },
            user: null,
          },
          ...(includeUserId
            ? [
                {
                  user: {
                    is: {
                      id: includeUserId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        email: true,
        registration: true,
      },
    });
  }

  private mapStudent(student: StudentWithDetails): StudentResponse {
    const { billingCustomers, ...studentData } = student;

    const customer = billingCustomers[0];

    return {
      ...studentData,
      billingCustomer: customer
        ? { ...customer, hasDocument: !!customer.documentMasked }
        : null,
    };
  }

  private async getCompanyOrFail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: {
        id: companyId,
      },
      select: {
        id: true,
        emailDomain: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa nao encontrada.');
    }

    return company;
  }

  private async getAssignableGroupOrFail(companyId: string, groupId: string) {
    const group = await this.prisma.group.findFirst({
      where: {
        id: groupId,
        companyId,
        active: true,
      },
      select: {
        id: true,
      },
    });

    if (!group) {
      throw new BadRequestException(
        'Selecione um grupo ativo e valido para o aluno.',
      );
    }

    return group;
  }

  private async resolveNextGroupId(
    companyId: string,
    student: Awaited<ReturnType<StudentsService['findOne']>>,
    groupId: string,
  ) {
    if (groupId === student.groupId) {
      return student.groupId;
    }

    const group = await this.getAssignableGroupOrFail(companyId, groupId);

    return group.id;
  }

  private async getAssignableBillingTemplateOrFail(
    companyId: string,
    billingTemplateId: string,
  ) {
    const billingTemplate = await this.prisma.billingTemplate.findFirst({
      where: {
        id: billingTemplateId,
        companyId,
        active: true,
        targetScope: {
          in: [
            BillingTargetScope.STUDENTS,
            BillingTargetScope.STUDENTS_AND_COORDINATORS,
          ],
        },
      },
      select: {
        id: true,
      },
    });

    if (!billingTemplate) {
      throw new BadRequestException(
        'Selecione um grupo de boletos ativo e valido para o aluno.',
      );
    }

    return billingTemplate;
  }

  private async resolveNextBillingTemplateId(
    companyId: string,
    student: Awaited<ReturnType<StudentsService['findOne']>>,
    billingTemplateId: string,
  ) {
    if (billingTemplateId === student.billingTemplateId) {
      return student.billingTemplateId;
    }

    const billingTemplate = await this.getAssignableBillingTemplateOrFail(
      companyId,
      billingTemplateId,
    );

    return billingTemplate.id;
  }

  private async getAssignableRouteIdsOrFail(
    companyId: string,
    routeIds: string[],
    options?: {
      allowCurrentStudentId?: string;
    },
  ) {
    const uniqueRouteIds = Array.from(
      new Set(routeIds.map((routeId) => routeId.trim()).filter(Boolean)),
    );

    if (uniqueRouteIds.length === 0) {
      throw new BadRequestException(
        'Selecione pelo menos uma rota ativa para o aluno.',
      );
    }

    const routes = await this.prisma.route.findMany({
      where: {
        id: {
          in: uniqueRouteIds,
        },
        companyId,
        OR: [
          {
            active: true,
          },
          ...(options?.allowCurrentStudentId
            ? [
                {
                  students: {
                    some: {
                      studentId: options.allowCurrentStudentId,
                    },
                  },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
      },
    });

    if (routes.length !== uniqueRouteIds.length) {
      throw new BadRequestException(
        'Selecione apenas rotas ativas e validas para o aluno.',
      );
    }

    return uniqueRouteIds;
  }

  private normalizeStudentEmail(email: string | undefined, domain: string) {
    if (!email?.trim()) {
      return null;
    }

    const normalized = email.trim().toLowerCase();
    const expectedSuffix = `@${domain.toLowerCase()}`;

    if (normalized.includes('@')) {
      if (!normalized.endsWith(expectedSuffix)) {
        throw new BadRequestException(
          `O e-mail do aluno deve usar o dominio da empresa (${expectedSuffix}).`,
        );
      }

      return normalized;
    }

    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalized)) {
      throw new BadRequestException(
        'Use apenas letras, numeros, ponto, underline ou hifen antes do dominio.',
      );
    }

    return `${normalized}${expectedSuffix}`;
  }

  /**
   * Pagador (responsável financeiro) do aluno. Sem dados informados, o
   * pagador padrão é o próprio aluno (nome, e-mail e telefone dele).
   * Documento: omitido = mantém o atual, vazio = apaga, preenchido = valida,
   * cifra e guarda hash + máscara (o texto puro nunca é gravado).
   * Mudou nome, e-mail, telefone ou documento: o cliente no Asaas precisa
   * ser atualizado na próxima emissão (asaasSyncedAt = null).
   */
  private async syncBillingCustomer(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      studentId: string;
      studentName: string;
      studentEmail: string | null;
      studentPhone: string | null;
      billingCustomer?: StudentBillingCustomerDto;
    },
  ) {
    const existingCustomer = await tx.billingCustomer.findFirst({
      where: {
        companyId: params.companyId,
        studentId: params.studentId,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        documentHash: true,
      },
    });

    if (existingCustomer && params.billingCustomer === undefined) {
      return;
    }

    const contact = this.buildBillingCustomerContact(params);
    const documentData = this.buildBillingCustomerDocument(
      params.billingCustomer?.document,
    );

    if (!existingCustomer) {
      await tx.billingCustomer.create({
        data: {
          companyId: params.companyId,
          studentId: params.studentId,
          ...contact,
          ...(documentData ?? {}),
        },
      });
      return;
    }

    const changed =
      existingCustomer.name !== contact.name ||
      existingCustomer.email !== contact.email ||
      existingCustomer.phone !== contact.phone ||
      (documentData !== undefined &&
        existingCustomer.documentHash !== documentData.documentHash);

    await tx.billingCustomer.update({
      where: {
        id: existingCustomer.id,
      },
      data: {
        ...contact,
        ...(documentData ?? {}),
        document: null,
        ...(changed ? { asaasSyncedAt: null } : {}),
      },
    });
  }

  private buildBillingCustomerContact(params: {
    studentName: string;
    studentEmail: string | null;
    studentPhone: string | null;
    billingCustomer?: StudentBillingCustomerDto;
  }) {
    const providedName = this.normalizeOptionalString(
      params.billingCustomer?.name,
    );
    const providedEmail = this.normalizeOptionalEmail(
      params.billingCustomer?.email,
    );
    const providedPhone = this.normalizeOptionalString(
      params.billingCustomer?.phone,
    );
    const providedDocument = this.normalizeOptionalString(
      params.billingCustomer?.document,
    );

    if (!providedName && (providedEmail || providedDocument || providedPhone)) {
      throw new BadRequestException(
        'Informe o nome do responsavel financeiro.',
      );
    }

    return {
      name: providedName ?? params.studentName,
      email: providedEmail ?? params.studentEmail ?? null,
      phone: providedPhone ?? params.studentPhone ?? null,
    };
  }

  /** undefined = não mexe; null nos campos = apaga; senão, protegido. */
  private buildBillingCustomerDocument(document: string | undefined) {
    if (document === undefined) {
      return undefined;
    }

    const trimmed = document.trim();

    if (!trimmed) {
      return {
        documentEncrypted: null,
        documentHash: null,
        documentMasked: null,
      };
    }

    let digits: string;
    try {
      digits = normalizeCpfCnpj(trimmed);
    } catch (error) {
      if (error instanceof InvalidDocumentError) {
        throw new BadRequestException(
          `Responsável financeiro: ${error.message}`,
        );
      }
      throw error;
    }

    let masterKey: Buffer;
    try {
      masterKey = parseEncryptionKey(
        this.configService.get<string>('BILLING_ENCRYPTION_KEY'),
      );
    } catch (error) {
      if (error instanceof BillingEncryptionKeyError) {
        throw new ServiceUnavailableException(
          'O servidor não está pronto para guardar CPF/CNPJ com segurança. Fale com o suporte do UniPass.',
        );
      }
      throw error;
    }

    return protectDocument(digits, masterKey);
  }

  private normalizeOptionalEmail(value?: string | null) {
    const normalized = this.normalizeOptionalString(value);
    return normalized ? normalized.toLowerCase() : null;
  }

  private normalizeOptionalString(value?: string | null) {
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
