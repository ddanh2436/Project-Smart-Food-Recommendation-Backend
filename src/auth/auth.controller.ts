// src/auth/auth.controller.ts
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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard'; // Sẽ tạo ở bước 5
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport'; // <-- Import AuthGuard
import type { Response } from 'express'; // <-- Import Responsez

// Interface để thêm 'user' vào Request (từ Guard)
interface RequestWithUser extends Request {
  user: {
    sub: string;
    email: string;
  };
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Req() req) {
    // Passport-google sẽ tự động chuyển hướng đến Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Req() req, @Res() res: Response) {
    // 'req.user' lúc này là đối tượng 'user' từ GoogleStrategy
    const { accessToken, refreshToken } =
      await this.authService.signInWithGoogle(req.user);

    // Chuyển hướng người dùng về Frontend, đính kèm token
    // (Bạn nên lưu URL frontend trong .env)
    const frontendUrl = 'http://localhost:3000/auth/callback';
    res.redirect(
      `${frontendUrl}?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    // Lưu ý: create
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard) // <-- Bảo vệ route này
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: RequestWithUser) {
    // Lấy userId từ token đã được xác thực (gắn vào req bởi Guard)
    const userId = req.user.sub;
    return this.authService.logout(userId);
  }

  // Tạm thời chúng ta sẽ để route này đơn giản
  // Thực tế, bạn nên dùng RefreshTokenGuard riêng
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: { userId: string; refreshToken: string }) {
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  // Ví dụ về route được bảo vệ
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: RequestWithUser) {
    // req.user chứa { sub: userId, email } từ JwtStrategy
    const userId = req.user.sub;
    return this.authService.getProfile(userId); // 2. Gọi service
  }
}
