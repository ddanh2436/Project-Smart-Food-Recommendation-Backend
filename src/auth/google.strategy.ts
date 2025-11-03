// src/auth/google.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID') || '',
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET') || '',
      callbackURL: 'http://localhost:3001/auth/google/callback',
      scope: ['email', 'profile'], // Chúng ta muốn lấy email và profile
    });
  }

  // Hàm này sẽ chạy sau khi Google xác thực thành công
  // Google sẽ trả về profile và accessToken (của Google)
  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { name, emails, photos } = profile;
    const user = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      // accessToken (của Google, chúng ta không dùng)
    };
    
    // 'done' sẽ gửi đối tượng 'user' này đến hàm xử lý
    // trong AuthController (ở route /google/callback)
    done(null, user);
  }
}