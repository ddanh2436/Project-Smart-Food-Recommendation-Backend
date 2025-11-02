// src/auth/auth.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard'; // Sẽ tạo ở bước 5
import { Request } from 'express';

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
  refresh(@Body() body: { userId: string, refreshToken: string }) {
    return this.authService.refresh(body.userId, body.refreshToken);
  }

  // Ví dụ về route được bảo vệ
  @UseGuards(JwtAuthGuard)
  @Post('profile')
  getProfile(@Req() req: RequestWithUser) {
    return req.user; // Trả về thông tin user từ payload của token
  }
}