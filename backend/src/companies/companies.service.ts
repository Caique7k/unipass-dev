import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyPlan, UserRole } from '@prisma/client';
import { randomInt } from 'crypto';
import { hashPassword } from '../auth/password-hash.util';
import { PrismaService } from '../prisma/prisma.service';
import { safeCompareStrings } from 'src/security/secure-compare.util';
import { CreateCompanyOnboardingDto } from './dto/create-company-onboarding.dto';
import { RequestCompanyPlanChangeDto } from './dto/request-company-plan-change.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

type SmsChallenge = {
  code: string;
  expiresAt: Date;
  verifiedAt?: Date;
};

type CompanySummaryRecord = {
  id: string;
  name: string;
  cnpj: string;
  emailDomain: string;
  plan: CompanyPlan;
  requestedPlan: CompanyPlan | null;
  planChangeRequestedAt: Date | null;
  planChangeRequestedByName: string | null;
  planChangeRequestedByEmail: string | null;
  contactName: string | null;
  contactPhone: string | null;
  smsVerifiedAt: Date | null;
  createdAt: Date;
  _count: {
    users: number;
    students: number;
    buses: number;
    devices: number;
  };
};

type CurrentUserIdentity = {
  id: string;
  name?: string | null;
  email?: string | null;
};

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);
  private readonly smsChallenges = new Map<string, SmsChallenge>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findAll() {
    const companies = await this.prisma.company.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            users: true,
            students: true,
            buses: true,
            devices: true,
          },
        },
      },
    });

    return companies.map((company) => this.mapCompanySummary(company));
  }

  async findMine(companyId?: string | null) {
    const company = await this.getCompanySummaryOrFail(companyId);

    return this.mapCompanySummary(company);
  }

  async updateMine(
    companyId: string | null | undefined,
    dto: UpdateCompanyProfileDto,
  ) {
    const company = await this.getCompanyOrFail(companyId);
    const normalizedCnpj = this.normalizeCnpj(dto.cnpj);
    const normalizedPhone = dto.contactPhone
      ? this.normalizePhone(dto.contactPhone)
      : null;

    const existingCompanyByCnpj = await this.prisma.company.findUnique({
      where: { cnpj: normalizedCnpj },
      select: { id: true },
    });

    if (existingCompanyByCnpj && existingCompanyByCnpj.id !== company.id) {
      throw new BadRequestException(
        'Já existe uma empresa cadastrada com este CNPJ.',
      );
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        name: dto.name.trim(),
        cnpj: normalizedCnpj,
        contactName: dto.contactName?.trim() || null,
        contactPhone: normalizedPhone,
      },
    });

    return this.findMine(company.id);
  }

  async requestPlanChange(
    companyId: string | null | undefined,
    currentUser: CurrentUserIdentity,
    dto: RequestCompanyPlanChangeDto,
  ) {
    const company = await this.getCompanyOrFail(companyId);

    if (dto.plan === company.plan) {
      throw new BadRequestException(
        'Sua empresa já utiliza o plano selecionado.',
      );
    }

    if (company.requestedPlan === dto.plan && company.planChangeRequestedAt) {
      return {
        message:
          'Já existe uma solicitação pendente para este plano. O dono da plataforma já consegue visualizar essa pendência.',
        company: await this.findMine(company.id),
      };
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        requestedPlan: dto.plan,
        planChangeRequestedAt: new Date(),
        planChangeRequestedByName: currentUser.name?.trim() || null,
        planChangeRequestedByEmail:
          currentUser.email?.trim().toLowerCase() || null,
      },
    });

    return {
      message:
        'Solicitação de mudança de plano enviada com sucesso. O dono da plataforma verá essa pendência e poderá entrar em contato com o responsável.',
      company: await this.findMine(company.id),
    };
  }

  async applyRequestedPlan(companyId: string) {
    const company = await this.getCompanyOrFail(companyId);

    if (!company.requestedPlan) {
      throw new BadRequestException(
        'Não há solicitação de plano pendente para esta empresa.',
      );
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        plan: company.requestedPlan,
        requestedPlan: null,
        planChangeRequestedAt: null,
        planChangeRequestedByName: null,
        planChangeRequestedByEmail: null,
      },
    });

    return {
      message: `Plano solicitado aplicado com sucesso para ${company.name}.`,
      company: this.mapCompanySummary(
        await this.getCompanySummaryOrFail(company.id),
      ),
    };
  }

  async checkDomainAvailability(rawDomain: string) {
    const normalizedDomain = this.normalizeDomain(rawDomain);
    const existingCompany = await this.prisma.company.findUnique({
      where: { emailDomain: normalizedDomain },
      select: { id: true, name: true },
    });

    if (!existingCompany) {
      return {
        available: true,
        normalizedDomain,
        suggestions: [] as string[],
      };
    }

    return {
      available: false,
      normalizedDomain,
      suggestions: await this.buildDomainSuggestions(normalizedDomain),
      message: `O domínio ${normalizedDomain} já está em uso.`,
    };
  }

  async sendSmsCode(phone: string) {
    const normalizedPhone = this.normalizePhone(phone);
    const code = `${randomInt(100000, 999999)}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const provider = this.getSmsProvider();

    this.smsChallenges.set(normalizedPhone, {
      code,
      expiresAt,
    });

    if (provider === 'twilio') {
      await this.sendViaTwilio(normalizedPhone, code);
    }

    return {
      success: true,
      phone: normalizedPhone,
      expiresAt,
      delivery: provider === 'twilio' ? 'provider' : 'simulated',
      ...(provider === 'twilio' ? {} : { developmentCode: code }),
    };
  }

  verifySmsCode(phone: string, code: string) {
    const normalizedPhone = this.normalizePhone(phone);
    const challenge = this.smsChallenges.get(normalizedPhone);

    if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
      this.smsChallenges.delete(normalizedPhone);
      throw new BadRequestException('O código expirou. Solicite um novo SMS.');
    }

    if (!safeCompareStrings(challenge.code, code.trim())) {
      throw new BadRequestException('Código inválido.');
    }

    challenge.verifiedAt = new Date();
    this.smsChallenges.set(normalizedPhone, challenge);

    return {
      success: true,
      phone: normalizedPhone,
      verifiedAt: challenge.verifiedAt,
    };
  }

  async createOnboarding(dto: CreateCompanyOnboardingDto) {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const normalizedDomain = this.normalizeDomain(dto.domain);
    const challenge = this.smsChallenges.get(normalizedPhone);

    if (!challenge?.verifiedAt) {
      throw new BadRequestException(
        'Verifique o telefone por SMS antes de concluir o cadastro.',
      );
    }

    await this.ensureCompanyAvailability(dto.cnpj, normalizedDomain);

    const normalizedAdminEmail = this.composeCompanyEmail(
      dto.adminLogin,
      normalizedDomain,
    );
    await this.ensureAdminEmailAvailability(normalizedAdminEmail);

    const hashedPassword = await hashPassword(dto.password);

    const company = await this.prisma.$transaction(async (tx) => {
      const createdCompany = await tx.company.create({
        data: {
          name: dto.companyName.trim(),
          cnpj: this.normalizeCnpj(dto.cnpj),
          emailDomain: normalizedDomain,
          plan: dto.plan,
          contactName: dto.contactName.trim(),
          contactPhone: normalizedPhone,
          smsVerifiedAt: challenge.verifiedAt,
        },
      });

      await tx.user.create({
        data: {
          companyId: createdCompany.id,
          name: dto.adminName.trim(),
          email: normalizedAdminEmail,
          password: hashedPassword,
          role: UserRole.ADMIN,
          active: true,
        },
      });

      return createdCompany;
    });

    this.smsChallenges.delete(normalizedPhone);

    return {
      success: true,
      companyId: company.id,
      loginEmail: normalizedAdminEmail,
      plan: company.plan,
    };
  }

  private async ensureCompanyAvailability(cnpj: string, domain: string) {
    const [existingCompanyByCnpj, existingCompanyByDomain] = await Promise.all([
      this.prisma.company.findUnique({
        where: { cnpj: this.normalizeCnpj(cnpj) },
        select: { id: true },
      }),
      this.prisma.company.findUnique({
        where: { emailDomain: domain },
        select: { id: true },
      }),
    ]);

    if (existingCompanyByCnpj) {
      throw new BadRequestException(
        'Já existe uma empresa cadastrada com este CNPJ.',
      );
    }

    if (existingCompanyByDomain) {
      throw new BadRequestException(
        'Este domínio já está em uso por outra empresa.',
      );
    }
  }

  private async ensureAdminEmailAvailability(email: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('Já existe um usuário com este e-mail.');
    }
  }

  private async getCompanyOrFail(companyId?: string | null) {
    if (!companyId) {
      throw new BadRequestException('Usuário sem empresa vinculada.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Empresa não encontrada.');
    }

    return company;
  }

  private async getCompanySummaryOrFail(companyId?: string | null) {
    if (!companyId) {
      throw new BadRequestException('Usuário sem empresa vinculada.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        _count: {
          select: {
            users: true,
            students: true,
            buses: true,
            devices: true,
          },
        },
      },
    });

    if (!company) {
      throw new BadRequestException('Empresa não encontrada.');
    }

    return company;
  }

  private mapCompanySummary(company: CompanySummaryRecord) {
    return {
      id: company.id,
      name: company.name,
      cnpj: company.cnpj,
      emailDomain: company.emailDomain,
      plan: company.plan,
      contactName: company.contactName,
      contactPhone: company.contactPhone,
      smsVerifiedAt: company.smsVerifiedAt,
      createdAt: company.createdAt,
      _count: company._count,
      pendingPlanChangeRequest: this.buildPendingPlanChangeRequest(company),
    };
  }

  private buildPendingPlanChangeRequest(company: {
    plan: CompanyPlan;
    requestedPlan: CompanyPlan | null;
    planChangeRequestedAt: Date | null;
    planChangeRequestedByName: string | null;
    planChangeRequestedByEmail: string | null;
  }) {
    if (!company.requestedPlan || !company.planChangeRequestedAt) {
      return null;
    }

    return {
      currentPlan: company.plan,
      requestedPlan: company.requestedPlan,
      requestedAt: company.planChangeRequestedAt,
      requestedByName: company.planChangeRequestedByName,
      requestedByEmail: company.planChangeRequestedByEmail,
    };
  }

  private normalizeDomain(domain: string) {
    const sanitized = domain
      .trim()
      .toLowerCase()
      .replace(/^@+/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9.-]/g, '');

    if (
      !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+$/.test(sanitized)
    ) {
      throw new BadRequestException(
        'Informe um domínio válido, como empresa.com.br.',
      );
    }

    return sanitized;
  }

  private composeCompanyEmail(login: string, domain: string) {
    const normalizedLogin = login
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9._-]/g, '');

    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(normalizedLogin)) {
      throw new BadRequestException(
        'Use apenas letras, numeros, ponto, underline ou hifen no login.',
      );
    }

    return `${normalizedLogin}@${domain}`;
  }

  private normalizePhone(phone: string) {
    const digits = phone.replace(/\D/g, '');

    if (digits.length < 10 || digits.length > 13) {
      throw new BadRequestException('Informe um telefone celular válido.');
    }

    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
  }

  private normalizeCnpj(cnpj: string) {
    const digits = cnpj.replace(/\D/g, '');

    if (digits.length !== 14) {
      throw new BadRequestException('Informe um CNPJ válido com 14 dígitos.');
    }

    return digits;
  }

  private async buildDomainSuggestions(domain: string) {
    const [root, ...rest] = domain.split('.');
    const suffix = rest.length > 0 ? `.${rest.join('.')}` : '.com.br';
    const base = root.replace(/-+/g, '-');
    const variants = [
      `${base}oficial${suffix}`,
      `${base}transportes${suffix}`,
      `${base}mobility${suffix}`,
      `${base}app${suffix}`,
      `${base}01${suffix}`,
      `${base}-grupo${suffix}`,
    ];

    const uniqueVariants = [...new Set(variants)].filter(
      (candidate) => candidate !== domain,
    );

    const companies = await this.prisma.company.findMany({
      where: {
        emailDomain: {
          in: uniqueVariants,
        },
      },
      select: {
        emailDomain: true,
      },
    });

    const used = new Set(companies.map((company) => company.emailDomain));

    return uniqueVariants
      .filter((candidate) => !used.has(candidate))
      .slice(0, 4);
  }

  private getSmsProvider() {
    const provider = this.configService
      .get<string>('SMS_PROVIDER')
      ?.trim()
      .toLowerCase();
    const nodeEnv = this.configService
      .get<string>('NODE_ENV')
      ?.trim()
      .toLowerCase();

    if (!provider || provider === 'dev' || provider === 'mock') {
      if (nodeEnv === 'production') {
        throw new ServiceUnavailableException(
          'O envio de SMS nao esta configurado no servidor.',
        );
      }

      return 'mock';
    }

    if (provider === 'twilio') {
      return 'twilio';
    }

    throw new ServiceUnavailableException(
      'O provedor de SMS configurado não é suportado.',
    );
  }

  private async sendViaTwilio(phone: string, code: string) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    const messagingServiceSid = this.configService.get<string>(
      'TWILIO_MESSAGING_SERVICE_SID',
    );
    const from = this.configService.get<string>('TWILIO_FROM_NUMBER');

    if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
      this.logger.error(
        'Configuração Twilio incompleta. Defina TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_MESSAGING_SERVICE_SID ou TWILIO_FROM_NUMBER.',
      );
      throw new ServiceUnavailableException(
        'O envio de SMS não está configurado no servidor.',
      );
    }

    const payload = new URLSearchParams({
      To: phone,
      Body: `Seu código de verificação UniPass é ${code}. Ele expira em 10 minutos.`,
    });

    if (messagingServiceSid) {
      payload.set('MessagingServiceSid', messagingServiceSid);
    } else if (from) {
      payload.set('From', from);
    }

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString(
      'base64',
    );

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();

      this.logger.error(
        `Falha ao enviar SMS pela Twilio para ${phone}: ${response.status} ${responseText}`,
      );

      throw new ServiceUnavailableException(
        'Não foi possível enviar o SMS de verificação agora.',
      );
    }
  }
}
