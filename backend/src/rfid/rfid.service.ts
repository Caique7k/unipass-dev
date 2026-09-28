import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkRfidDto } from './dto/link-rfid.dto';
import { StartRfidCaptureDto } from './dto/start-rfid-capture.dto';
import { requireRfidTag } from './rfid-tag.util';
import { assignRfidTagToStudent, isRfidCardReusable } from './rfid-card.assign';

const CAPTURE_TTL_MS = 60_000;

type AuthUser = { id: string; companyId: string | null };

@Injectable()
export class RfidService {
  constructor(private readonly prisma: PrismaService) {}

  async link(companyId: string, dto: LinkRfidDto) {
    const { studentId } = dto;
    const rfidTag = requireRfidTag(dto.rfidTag);

    // 1️⃣ aluno existe?
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        companyId,
      },
    });

    if (!student) {
      throw new NotFoundException('Aluno não encontrado');
    }

    // TAG de aluno inativo já nasce "livre" (seção 6 do CLAUDE.md): não faz sentido vincular.
    if (!student.active) {
      throw new BadRequestException(
        'Aluno inativo. Reative o aluno antes de vincular uma TAG.',
      );
    }

    // 2️⃣ vincula (reaproveita a TAG se ela estiver livre na empresa)
    return this.prisma.$transaction(async (tx) => {
      const card = await assignRfidTagToStudent(tx, {
        companyId,
        studentId,
        tag: rfidTag,
      });

      if (dto.replaceExisting) {
        await tx.rfidCard.updateMany({
          where: {
            companyId,
            studentId,
            active: true,
            id: { not: card.id },
          },
          data: { active: false },
        });
      }

      return card;
    });
  }

  /**
   * Abre uma janela de 60 s em que a próxima TAG lida pelo UniHub é
   * guardada para o painel, em vez de virar embarque/desembarque.
   */
  async startCapture(user: AuthUser, dto: StartRfidCaptureDto) {
    const companyId = this.requireCompany(user);
    const device = await this.prisma.device.findFirst({
      where: { id: dto.deviceId, companyId },
      select: { id: true, active: true, code: true, secret: true, name: true },
    });

    if (!device) {
      throw new NotFoundException('UniHub não encontrado.');
    }

    if (!device.active) {
      throw new BadRequestException('Este UniHub está desativado.');
    }

    if (!device.code || !device.secret) {
      throw new BadRequestException(
        'Este UniHub ainda não concluiu o pareamento.',
      );
    }

    const now = new Date();

    // Um UniHub só atende uma captura por vez: a mais recente vence.
    await this.prisma.rfidCaptureSession.updateMany({
      where: {
        deviceId: device.id,
        tag: null,
        cancelledAt: null,
        expiresAt: { gt: now },
      },
      data: { cancelledAt: now },
    });

    const session = await this.prisma.rfidCaptureSession.create({
      data: {
        companyId,
        deviceId: device.id,
        requestedById: user.id,
        expiresAt: new Date(now.getTime() + CAPTURE_TTL_MS),
      },
    });

    return {
      id: session.id,
      status: 'PENDING',
      expiresAt: session.expiresAt,
      deviceName: device.name,
    };
  }

  async getCapture(user: AuthUser, id: string) {
    const companyId = this.requireCompany(user);
    const session = await this.prisma.rfidCaptureSession.findFirst({
      where: { id, companyId },
    });

    if (!session) {
      throw new NotFoundException('Leitura não encontrada.');
    }

    if (session.tag) {
      const existingCard = await this.prisma.rfidCard.findUnique({
        where: { tag: session.tag },
        select: {
          companyId: true,
          active: true,
          student: { select: { name: true, active: true } },
        },
      });
      // TAG livre (aluno desativado etc.) pode ser vinculada de novo.
      const inUse = Boolean(
        existingCard && !isRfidCardReusable(existingCard, companyId),
      );

      return {
        id: session.id,
        status: 'CAPTURED',
        tag: session.tag,
        capturedAt: session.capturedAt,
        expiresAt: session.expiresAt,
        alreadyRegistered: inUse,
        // Nome só quando a TAG é da mesma empresa — não vaza dado de outro tenant.
        linkedStudentName:
          inUse && existingCard?.companyId === companyId
            ? (existingCard.student?.name ?? null)
            : null,
      };
    }

    const status = session.cancelledAt
      ? 'CANCELLED'
      : session.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'PENDING';

    return {
      id: session.id,
      status,
      tag: null,
      expiresAt: session.expiresAt,
    };
  }

  async cancelCapture(user: AuthUser, id: string) {
    const companyId = this.requireCompany(user);
    const result = await this.prisma.rfidCaptureSession.updateMany({
      where: { id, companyId, tag: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });

    return { cancelled: result.count === 1 };
  }

  private requireCompany(user: AuthUser) {
    if (!user.companyId) {
      throw new BadRequestException('Usuário sem empresa vinculada.');
    }

    return user.companyId;
  }
}
