// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from 'src/users/users.module'; // 1. Import UsersModule
import { JwtModule } from '@nestjs/jwt'; // 2. Import JwtModule
import { ConfigModule, ConfigService } from '@nestjs/config'; // 3. Import Config
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy'; 
import { GoogleStrategy } from './google.strategy';

@Module({
  imports: [
    UsersModule, // 4. Thêm UsersModule
    PassportModule, // 5. Thêm PassportModule
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' }, 
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, GoogleStrategy], 
})
export class AuthModule {}
