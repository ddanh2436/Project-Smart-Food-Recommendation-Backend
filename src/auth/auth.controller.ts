import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Get,
  Res,
  Patch,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  AuthService,
  EmailRegisteredWithPasswordError,
  GoogleProfile,
} from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleCallbackGuard } from './google-callback.guard';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

interface RequestWithUser extends Request {
  user: { sub: string; email: string; sid?: string };
}

interface RequestWithGoogleUser extends Request {
  user: GoogleProfile;
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  // ------------------------------------------------------------- Google
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(): void {
    // Passport's guard performs the redirect to Google; nothing to do here.
  }

  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  async googleAuthRedirect(
    @Req() req: RequestWithGoogleUser,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.resolveFrontendUrl();

    // No user means Passport rejected the callback: a state that did not match
    // the cookie, an unverified Google email, or the user cancelling.
    if (!req.user) {
      res.redirect(`${frontendUrl}/auth?error=google_signin_failed`);
      return;
    }

    try {
      const { accessToken, refreshToken } =
        await this.authService.signInWithGoogle(req.user);

      /**
       * Tokens are handed over in the URL *fragment*, not the query string.
       *
       * A query string is sent to the server, recorded in access logs, kept in
       * browser history and leaked through the Referer header. A fragment never
       * leaves the browser, and the callback page strips it from the address bar
       * immediately after reading it.
       */
      const fragment = new URLSearchParams({
        accessToken,
        refreshToken,
      }).toString();
      res.redirect(`${frontendUrl}/auth/callback#${fragment}`);
    } catch (error) {
      if (error instanceof EmailRegisteredWithPasswordError) {
        res.redirect(`${frontendUrl}/auth?error=email_uses_password`);
        return;
      }
      this.logger.error(
        `Google sign-in failed: ${error instanceof Error ? error.message : error}`,
      );
      res.redirect(`${frontendUrl}/auth?error=google_signin_failed`);
    }
  }

  // ------------------------------------------- Email / password sign-in
  /**
   * Stricter rate limits than the global default: these are the endpoints worth
   * brute-forcing. 5 registrations and 10 login attempts per minute per IP.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: RequestWithUser) {
    return this.authService.logout(req.user.sub, req.user.sid);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto) {
    // The user id is taken from the verified token, not from the request body.
    return this.authService.refresh(body.refreshToken);
  }

  // --------------------------------------------------------------- Profile
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: RequestWithUser) {
    return this.authService.getProfile(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.authService.updateProfile(req.user.sub, updateUserDto);
  }

  // Same budget as login: this endpoint also checks a password.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Req() req: RequestWithUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.sub,
      req.user.sid,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /**
   * Where to send the browser after Google sign-in.
   *
   * Read through ConfigService rather than `process.env` directly so it honours
   * the same configuration source as the rest of the app, and trailing slashes
   * are trimmed so the redirect never contains a double slash.
   */
  private resolveFrontendUrl(): string {
    const configured =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return configured.replace(/\/+$/, '');
  }
}
