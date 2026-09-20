import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { GoogleProfile } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private static readonly logger = new Logger(GoogleStrategy.name);

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const backendUrl = (
      configService.get<string>('BACKEND_URL') ?? 'http://localhost:3001'
    ).replace(/\/+$/, '');

    /**
     * Warn loudly when Google OAuth is unconfigured.
     *
     * The previous code defaulted both credentials to '' so the strategy
     * registered successfully and only failed at Google's end with an opaque
     * "invalid_client", which is hard to trace back to a missing env var.
     * Placeholders keep the app bootable (email/password login still works)
     * while making the cause obvious in the logs.
     */
    if (!clientID || !clientSecret) {
      GoogleStrategy.logger.warn(
        'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. ' +
          '"Continue with Google" will not work until they are configured. ' +
          `The redirect URI to register in Google Cloud Console is ` +
          `${backendUrl}/auth/google/callback`,
      );
    }

    super({
      clientID: clientID || 'missing-google-client-id',
      clientSecret: clientSecret || 'missing-google-client-secret',
      callbackURL: `${backendUrl}/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      name?: { givenName?: string; familyName?: string };
      emails?: Array<{ value: string }>;
      photos?: Array<{ value: string }>;
    },
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      // Optional chaining throughout: the old code indexed emails[0].value
      // directly, so a Google account with no public email threw a TypeError
      // inside Passport and surfaced as a 500.
      return done(new Error('Google account has no email address'), undefined);
    }

    const user: GoogleProfile = {
      email,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      picture: profile.photos?.[0]?.value,
    };
    done(null, user);
  }
}
