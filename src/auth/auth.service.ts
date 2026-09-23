import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserDocument } from 'src/users/schemas/user.schema';
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

export interface GoogleProfile {
  email: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

/**
 * Thrown when a Google sign-in lands on an email that already belongs to a
 * password account. The controller turns it into a specific redirect, so the
 * sign-in page can tell the user what to do instead of a generic failure.
 */
export class EmailRegisteredWithPasswordError extends Error {
  constructor() {
    super('This email is registered with a password');
    this.name = 'EmailRegisteredWithPasswordError';
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/** What jsonwebtoken accepts for `expiresIn` (e.g. '15m', '7d', or seconds). */
type SignExpiry = Parameters<JwtService['signAsync']>[1] extends
  | { expiresIn?: infer E }
  | undefined
  ? E
  : never;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto): Promise<Tokens> {
    const existingUser = await this.usersService.findByEmailOrNull(
      registerDto.email,
    );
    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const existingUsername = await this.usersService.findByUsernameOrNull(
      registerDto.username,
    );
    if (existingUsername) {
      throw new BadRequestException('Username already taken');
    }

    const newUser = await this.usersService.create(registerDto);
    return this.issueTokens(newUser);
  }

  async login(loginDto: LoginDto): Promise<Tokens> {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    /**
     * One generic error for "no such email" and "wrong password".
     *
     * `findOneByEmail` used to throw NotFoundException, so a missing account
     * answered 404 while a wrong password answered 401 — which let anyone
     * enumerate which email addresses are registered.
     */
    if (!user) {
      // Spend roughly the same time as a real bcrypt comparison so response
      // timing does not reveal whether the account exists.
      await bcrypt.compare(loginDto.password, DUMMY_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Google accounts hold an unguessable random password. Say so plainly
    // instead of letting the user retry a password that cannot ever work.
    if (user.provider === 'google') {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Please continue with Google.',
      );
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<{ success: boolean }> {
    await this.usersService.setRefreshTokenHash(userId, null);
    return { success: true };
  }

  /**
   * Exchange a valid refresh token for a new token pair.
   *
   * The refresh token is now verified as a JWT *before* the database is
   * touched, so a forged or expired token is rejected without a query, and the
   * user id comes from the verified payload rather than from the request body.
   */
  async refresh(refreshToken: string): Promise<Tokens> {
    if (!refreshToken) {
      throw new ForbiddenException('Refresh token required');
    }

    let payload: { sub: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new ForbiddenException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findByIdWithRefreshToken(payload.sub);
    if (!user || !user.hashedRefreshToken) {
      throw new ForbiddenException('Access denied');
    }

    /**
     * Compare against the stored *hash*. The old code passed the raw token to
     * `updateRefreshToken` while its comment claimed it had already been
     * hashed — the private `_hashData` helper existed but was never called. So
     * `bcrypt.compare(rawToken, rawToken)` always returned false and refresh
     * was permanently broken, on top of storing the token in plaintext.
     */
    const isMatch = await bcrypt.compare(
      refreshToken,
      user.hashedRefreshToken,
    );
    if (!isMatch) {
      // A mismatch can mean a stolen token is being replayed after the real
      // client already rotated it, so revoke the session entirely.
      await this.usersService.setRefreshTokenHash(user._id.toString(), null);
      throw new ForbiddenException('Access denied');
    }

    return this.issueTokens(user);
  }

  async signInWithGoogle(googleUser: GoogleProfile): Promise<Tokens> {
    if (!googleUser?.email) {
      throw new BadRequestException('Google profile is missing an email');
    }

    let user = await this.usersService.findByEmailOrNull(googleUser.email);

    /**
     * Never sign a Google user in to a password account.
     *
     * Registration does not verify email addresses, so the owner of a password
     * account is only whoever typed the address first. Linking on email let an
     * attacker register victim@gmail.com with a password of their choosing and
     * wait: when the real owner later used "Continue with Google", they were
     * signed in to the attacker's account — which the attacker could still
     * open with the password. Only accounts created through Google are joined.
     */
    if (user && user.provider !== 'google') {
      throw new EmailRegisteredWithPasswordError();
    }

    if (user) {
      // Keep the avatar in sync with Google.
      if (googleUser.picture && user.picture !== googleUser.picture) {
        user = await this.usersService.updateProfileFields(
          user._id.toString(),
          { picture: googleUser.picture },
        );
      }
    } else {
      user = await this.usersService.create({
        email: googleUser.email,
        username: await this.usersService.buildUniqueUsername(
          googleUser.email.split('@')[0],
        ),
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        picture: googleUser.picture,
        // A cryptographically random password, not Math.random(). The old code
        // used `Math.random().toString(36).substring(7)` — about 6 characters
        // from a predictable PRNG, which is guessable.
        password: crypto.randomBytes(32).toString('hex'),
        provider: 'google',
      });
    }

    if (!user) {
      throw new BadRequestException('Could not sign in with Google');
    }
    return this.issueTokens(user);
  }

  async getProfile(userId: string) {
    return this.usersService.findOne(userId);
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    return this.usersService.updateProfileFields(userId, updateUserDto);
  }

  /** Mint a token pair and persist the hash of the refresh token. */
  private async issueTokens(user: UserDocument): Promise<Tokens> {
    const userId = user._id.toString();
    const payload = { sub: userId, email: user.email };

    // jsonwebtoken types `expiresIn` as a literal duration union, which a
    // plain `string` from config does not satisfy, hence the narrowing cast.
    const accessExpiresIn = (this.configService.get<string>('JWT_EXPIRES_IN') ??
      '15m') as SignExpiry;
    const refreshExpiresIn = (this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    ) ?? '7d') as SignExpiry;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: accessExpiresIn,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn,
      }),
    ]);

    // Hash before storing: a database dump must not hand out live sessions.
    const hash = await bcrypt.hash(refreshToken, 10);
    await this.usersService.setRefreshTokenHash(userId, hash);

    return { accessToken, refreshToken };
  }
}

/**
 * A real bcrypt hash of a throwaway value, compared against when an account is
 * not found so that both branches of login cost the same amount of time.
 */
const DUMMY_HASH =
  '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DqsHfhRxJXWxUCBs9WQK1zvVYrLHu';
