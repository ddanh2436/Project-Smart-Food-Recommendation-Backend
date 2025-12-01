// src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common'; // Thêm UnauthorizedException
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    
    const secret = configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('Thiếu JWT_SECRET trong tệp .env');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: any) {
    return { sub: payload.sub, email: payload.email };
  }
}