import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  BillingEncryptionKeyError,
  parseEncryptionKey,
} from './billing-crypto.util';
import { onlyDigits, protectDocument } from './billing-document.util';

const BATCH_SIZE = 200;

/**
 * Cifra os CPF/CNPJ de pagador que ainda estão no campo legado `document`
 * (gravados antes da cifra existir, ou pelo seed) e zera o texto puro.
 * Roda ao subir a API (registrado só no AppModule, não no worker). É
 * idempotente: cada linha só é atualizada se ainda tiver o texto puro.
 * O log traz só a contagem — nunca um documento.
 */
@Injectable()
export class BillingDocumentBackfill implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingDocumentBackfill.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.run();
    } catch (error) {
      this.logger.error(
        'Falha ao cifrar documentos legados de pagadores.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async run() {
    const pending = await this.prisma.billingCustomer.count({
      where: { document: { not: null } },
    });

    if (pending === 0) {
      return { protected: 0 };
    }

    let masterKey: Buffer;
    try {
      masterKey = parseEncryptionKey(
        this.configService.get<string>('BILLING_ENCRYPTION_KEY'),
      );
    } catch (error) {
      if (error instanceof BillingEncryptionKeyError) {
        this.logger.warn(
          `${pending} pagador(es) com CPF/CNPJ em texto puro, mas BILLING_ENCRYPTION_KEY não está configurada.`,
        );
        return { protected: 0 };
      }
      throw error;
    }

    let protectedCount = 0;

    for (;;) {
      const batch = await this.prisma.billingCustomer.findMany({
        where: { document: { not: null } },
        select: { id: true, document: true },
        take: BATCH_SIZE,
      });

      if (batch.length === 0) {
        break;
      }

      for (const customer of batch) {
        const digits = onlyDigits(customer.document ?? '');
        const result = await this.prisma.billingCustomer.updateMany({
          where: { id: customer.id, document: customer.document },
          data: {
            ...(digits
              ? protectDocument(digits, masterKey)
              : {
                  documentEncrypted: null,
                  documentHash: null,
                  documentMasked: null,
                }),
            document: null,
            asaasSyncedAt: null,
          },
        });
        protectedCount += result.count;
      }
    }

    this.logger.log(
      `${protectedCount} CPF/CNPJ de pagador cifrado(s) e removido(s) do texto puro.`,
    );
    return { protected: protectedCount };
  }
}
