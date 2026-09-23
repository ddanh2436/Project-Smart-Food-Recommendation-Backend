import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { GoogleProfile } from './auth.service';
import type { StateStore } from 'passport-oauth2';
import { CookieStateStore } from './oauth-state.store';

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
      // Bind the flow to the browser that started it; see CookieStateStore.
      // Secure cookies only over https, so local http development still works.
      // The cast is for the typings only: they declare overloaded signatures,
      // while passport-oauth2 dispatches on the implementation's arity (3 here).
      store: new CookieStateStore(
        backendUrl.startsWith('https://'),
      ) as unknown as StateStore,
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      name?: { givenName?: string; familyName?: string };
      emails?: Array<{ value: string; verified?: boolean }>;
      photos?: Array<{ value: string }>;
    },
    done: VerifyCallback,
  ): void {
    const primary = profile.emails?.[0];
    const email = primary?.value;
    // Only a Google-verified address may stand for an account. Sign-in links on
    // the email alone, so an unverified one would be a way into someone else's.
    if (email && primary?.verified === false) {
      return done(new Error('Google account email is not verified'), undefined);
    }
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
