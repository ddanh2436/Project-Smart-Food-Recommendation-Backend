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
  Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

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

  // ... (Các route Google, register, login, logout, refresh của bạn ở đây...)
  // ... (Giữ nguyên các hàm đó) ...

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
    const frontendUrl = 'http://localhost:3000/auth/callback'; // Sửa port FE nếu cần
    res.redirect(
      `${frontendUrl}?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: RequestWithUser) {
    const userId = req.user.sub;
    return this.authService.logout(userId);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: { userId: string; refreshToken: string }) {
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  // --- THÊM HÀM NÀY VÀO (ĐÂY LÀ PHẦN BỊ THIẾU) ---
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Req() req: RequestWithUser) {
    const userId = req.user.sub;
    return this.authService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: RequestWithUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const userId = req.user.sub;
    return this.authService.updateProfile(userId, updateUserDto);
  }
}
