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

  /**
   * Sign this device out, or every device when the session is not known.
   *
   * Access tokens carry the session id, so logging out on a phone ends the
   * phone's session and leaves the laptop signed in. Tokens minted before
   * that existed have no id, and for those everything is revoked.
   */
  async logout(userId: string, sid?: string): Promise<{ success: boolean }> {
    if (sid) {
      await this.usersService.removeRefreshSession(userId, sid);
    } else {
      await this.usersService.clearRefreshSessions(userId);
    }
    return { success: true };
  }

  /**
   * Exchange a valid refresh token for a new token pair.
   *
   * The refresh token is verified as a JWT *before* the database is touched,
   * so a forged or expired token is rejected without a query, and the user id
   * comes from the verified payload rather than from the request body.
   */
  async refresh(refreshToken: string): Promise<Tokens> {
    if (!refreshToken) {
      throw new ForbiddenException('Refresh token required');
    }

    let payload: { sub: string; email: string; sid?: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new ForbiddenException('Invalid or expired refresh token');
    }

    // Tokens from before per-device sessions have no id. Their stored hash
    // was a bcrypt of the whole JWT, and bcrypt reads only the first 72
    // bytes -- the header and the start of `sub` -- so any old token of the
    // same user matched it. They are not honoured; one sign-in replaces them.
    const { sid } = payload;
    if (!sid) {
      throw new ForbiddenException('Access denied');
    }

    const user = await this.usersService.findByIdWithSessions(payload.sub);
    const session = user?.refreshSessions?.find((s) => s.sid === sid);
    if (!user || !session) {
      throw new ForbiddenException('Access denied');
    }

    const userId = user._id.toString();
    const presented = sha256(refreshToken);

    if (presented === session.hash && session.expiresAt > new Date()) {
      const next = await this.signPair(user, sid);
      const rotated = await this.usersService.rotateRefreshSession(
        userId,
        sid,
        presented,
        next.hash,
        next.expiresAt,
      );
      // Lost the race to a concurrent refresh of the same token, which
      // already rotated it. Refuse this one, but do not treat it as theft.
      if (!rotated) {
        throw new ForbiddenException('Refresh token already used');
      }
      return next.tokens;
    }

    // The token this one replaced, seconds ago: a request that was in flight
    // across the rotation, or a second tab. Refused, but the session stays.
    if (
      presented === session.prevHash &&
      session.rotatedAt &&
      Date.now() - session.rotatedAt.getTime() < REUSE_GRACE_MS
    ) {
      throw new ForbiddenException('Refresh token already used');
    }

    // An older token from this session coming back means two parties hold
    // it -- the usual sign of a stolen token being replayed. End the session.
    await this.usersService.removeRefreshSession(userId, sid);
    this.logger.warn(`Refresh token reuse for user ${userId}; session revoked`);
    throw new ForbiddenException('Access denied');
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

  /** Start a new device session and mint its first token pair. */
  private async issueTokens(user: UserDocument): Promise<Tokens> {
    const sid = crypto.randomBytes(16).toString('base64url');
    const { tokens, hash, expiresAt } = await this.signPair(user, sid);
    await this.usersService.addRefreshSession(
      user._id.toString(),
      { sid, hash, expiresAt },
      MAX_SESSIONS,
    );
    return tokens;
  }

  /**
   * Sign an access/refresh pair for a session, without storing anything.
   *
   * The refresh token gets a random `jti` so two tokens issued in the same
   * second are still different strings -- otherwise a rotation inside one
   * second would hand back the token it was meant to replace.
   */
  private async signPair(user: UserDocument, sid: string) {
    const payload = { sub: user._id.toString(), email: user.email, sid };

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
      this.jwtService.signAsync(
        { ...payload, jti: crypto.randomBytes(12).toString('base64url') },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: refreshExpiresIn,
        },
      ),
    ]);

    // The token's own `exp` is the authority; this copy lets a session be
    // judged without decoding, and falls back to the configured lifetime.
    const decoded = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Hashed before storing, so a database dump does not hand out sessions.
    // SHA-256 rather than bcrypt: the token is a long random-signed string, not
    // a password, so there is nothing to slow down -- and bcrypt only reads the
    // first 72 bytes, which for a JWT is the same for every token of a user.
    return {
      tokens: { accessToken, refreshToken },
      hash: sha256(refreshToken),
      expiresAt,
    };
  }
}

/** Devices a user can be signed in on at once. */
const MAX_SESSIONS = 5;

/** How long the just-replaced refresh token is refused without revoking. */
const REUSE_GRACE_MS = 60_000;

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * A real bcrypt hash of a throwaway value, compared against when an account is
 * not found so that both branches of login cost the same amount of time.
 */
const DUMMY_HASH =
  '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DqsHfhRxJXWxUCBs9WQK1zvVYrLHu';
