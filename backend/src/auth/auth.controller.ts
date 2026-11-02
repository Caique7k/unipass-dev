import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  private getBaseCookieOptions(): CookieOptions {
    const sameSite =
      (this.configService.get<string>('COOKIE_SAME_SITE')?.toLowerCase() as
        | 'lax'
        | 'strict'
        | 'none'
        | undefined) ?? 'lax';

    const secure =
      (
        this.configService.get<string>('COOKIE_SECURE') ?? 'false'
      ).toLowerCase() === 'true';

    const domain = this.configService.get<string>('COOKIE_DOMAIN')?.trim();

    return {
      httpOnly: true,
      secure,
      sameSite,
      path: '/',
      ...(domain ? { domain } : {}),
    };
  }

  // Sem "manter conectado": cookie de sessão. Com: o cookie vence junto com o
  // token. O maxAge (contado pelo navegador a partir do recebimento) não
  // depende do relógio do computador do usuário; o Express também escreve o
  // Expires, que cai no mesmo segundo do exp do token.
  private getCookieOptions(
    rememberMe: boolean,
    tokenExpiresAt: Date,
  ): CookieOptions {
    if (!rememberMe) {
      return this.getBaseCookieOptions();
    }

    return {
      ...this.getBaseCookieOptions(),
      maxAge: tokenExpiresAt.getTime() - Date.now(),
    };
  }

  @Public()
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
    },
  })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rememberMe = dto.rememberMe ?? false;
    const { access_token, expiresAt } = await this.authService.login(
      dto.email,
      dto.password,
      rememberMe,
    );

    res.cookie(
      'token',
      access_token,
      this.getCookieOptions(rememberMe, expiresAt),
    );

    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: Request & { user: { id: string } }) {
    return this.authService.getMe(req.user.id);
  }

  @Public()
  @Throttle({
    default: {
      limit: 30,
      ttl: 60_000,
    },
  })
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token', this.getBaseCookieOptions());
    return { success: true };
  }
}
