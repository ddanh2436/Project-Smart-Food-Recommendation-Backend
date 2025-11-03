// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from 'src/users/users.module'; // 1. Import UsersModule
import { JwtModule } from '@nestjs/jwt'; // 2. Import JwtModule
import { ConfigModule, ConfigService } from '@nestjs/config'; // 3. Import Config
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy'; // Chúng ta sẽ tạo ở bước 5
import { GoogleStrategy } from './google.strategy';

@Module({
  imports: [
    UsersModule, // 4. Thêm UsersModule
    PassportModule, // 5. Thêm PassportModule
    // 6. Cấu hình JwtModule
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' }, // Access token hết hạn sau 15 phút
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy], // 7. Thêm JwtStrategy
})
export class AuthModule {}
