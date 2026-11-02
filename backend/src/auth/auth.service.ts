import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { OpaqueIdService } from 'src/security/opaque-id.service';
import { createDummyPasswordHash, verifyPassword } from './password-hash.util';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private readonly opaqueIdService: OpaqueIdService,
  ) {}

  // O Nest espera este passo antes de aceitar requisições: o primeiro login
  // com e-mail inexistente não paga a geração do hash falso.
  async onModuleInit() {
    await this.getDummyPasswordHash();
  }

  private getDummyPasswordHash() {
    this.dummyPasswordHash ??= createDummyPasswordHash();
    return this.dummyPasswordHash;
  }

  private getTokenExpiration(rememberMe: boolean) {
    if (rememberMe) {
      return (
        (this.configService.get<string>(
          'JWT_REMEMBER_EXPIRES',
        ) as StringValue) ?? '30d'
      );
    }

    return (
      (this.configService.get<string>('JWT_EXPIRES') as StringValue) ?? '1h'
    );
  }

  async login(email: string, password: string, rememberMe = false) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        company: {
          select: {
            emailDomain: true,
            name: true,
          },
        },
      },
    });

    // Exatamente uma comparação em toda tentativa (usuário ativo, inativo ou
    // inexistente), para a resposta levar o mesmo tempo nos três casos. A
    // decisão vem só depois, e exige um usuário real e ativo.
    const passwordMatch = await verifyPassword(
      password,
      user?.password ?? (await this.getDummyPasswordHash()),
    );

    if (!user || !user.active || !passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: this.opaqueIdService.encode(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: this.opaqueIdService.encode(user.companyId),
      emailDomain: user.company?.emailDomain ?? null,
      companyName: user.company?.name ?? null,
    };

    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: this.getTokenExpiration(rememberMe),
      }),
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        companyId: true,
        company: {
          select: {
            emailDomain: true,
            name: true,
          },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      emailDomain: user.company?.emailDomain ?? null,
      companyName: user.company?.name ?? null,
    };
  }
}
