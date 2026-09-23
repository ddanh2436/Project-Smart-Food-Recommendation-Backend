import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import {
  AuthService,
  EmailRegisteredWithPasswordError,
} from './auth.service';
import { UsersService } from 'src/users/users.service';

/**
 * These tests pin down the auth bugs that were fixed, so a future refactor
 * cannot quietly reintroduce them.
 */
describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;

  const secrets: Record<string, string> = {
    JWT_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  const makeUser = (overrides: Record<string, unknown> = {}) =>
    ({
      _id: { toString: () => 'user-1' },
      email: 'a@b.com',
      username: 'ab',
      password: '',
      provider: null,
      ...overrides,
    }) as never;

  beforeEach(async () => {
    usersService = {
      findByEmailOrNull: jest.fn(),
      findByUsernameOrNull: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      findByIdWithSessions: jest.fn(),
      addRefreshSession: jest.fn().mockResolvedValue(undefined),
      rotateRefreshSession: jest.fn().mockResolvedValue(true),
      removeRefreshSession: jest.fn().mockResolvedValue(undefined),
      clearRefreshSessions: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      findOne: jest.fn(),
      updateProfileFields: jest.fn(),
      buildUniqueUsername: jest.fn().mockResolvedValue('ab'),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
      decode: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => secrets[key] },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('refresh sessions', () => {
    const sha256 = (v: string) =>
      crypto.createHash('sha256').update(v).digest('hex');
    const future = () => new Date(Date.now() + 3600_000);

    const withSession = (session: Record<string, unknown>) => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
        sid: 's1',
      });
      (usersService.findByIdWithSessions as jest.Mock).mockResolvedValue(
        makeUser({ refreshSessions: [{ sid: 's1', ...session }] }),
      );
    };

    it('stores a SHA-256 of the refresh token in a new session, never the token', async () => {
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(null);
      (usersService.findByUsernameOrNull as jest.Mock).mockResolvedValue(null);
      (usersService.create as jest.Mock).mockResolvedValue(makeUser());

      await service.register({
        email: 'a@b.com',
        username: 'ab',
        password: 'secret123',
      } as never);

      const [userId, session, max] = (
        usersService.addRefreshSession as jest.Mock
      ).mock.calls.at(-1)!;
      expect(userId).toBe('user-1');
      expect(session.hash).toBe(sha256('signed.jwt.token'));
      expect(session.sid).toEqual(expect.any(String));
      expect(max).toBe(5);
    });

    it('puts a unique jti on every refresh token', async () => {
      (usersService.findByEmailWithPassword as jest.Mock).mockResolvedValue(
        makeUser({ password: await bcrypt.hash('pw-123456', 10) }),
      );
      await service.login({ email: 'a@b.com', password: 'pw-123456' } as never);
      await service.login({ email: 'a@b.com', password: 'pw-123456' } as never);

      const jtis = (jwtService.signAsync as jest.Mock).mock.calls
        .map(([payload]) => payload.jti)
        .filter(Boolean);
      expect(jtis).toHaveLength(2);
      expect(jtis[0]).not.toBe(jtis[1]);
    });

    it('rotates a session whose current token is presented', async () => {
      withSession({ hash: sha256('current.jwt.token'), expiresAt: future() });

      await expect(service.refresh('current.jwt.token')).resolves.toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'signed.jwt.token',
      });
      expect(usersService.rotateRefreshSession).toHaveBeenCalledWith(
        'user-1',
        's1',
        sha256('current.jwt.token'),
        sha256('signed.jwt.token'),
        expect.any(Date),
      );
    });

    it('refuses without revoking when a concurrent refresh won the rotation', async () => {
      withSession({ hash: sha256('current.jwt.token'), expiresAt: future() });
      (usersService.rotateRefreshSession as jest.Mock).mockResolvedValue(false);

      await expect(service.refresh('current.jwt.token')).rejects.toThrow(
        'already used',
      );
      expect(usersService.removeRefreshSession).not.toHaveBeenCalled();
    });

    it('refuses without revoking the token replaced a moment ago', async () => {
      withSession({
        hash: sha256('newer.jwt.token'),
        prevHash: sha256('current.jwt.token'),
        rotatedAt: new Date(),
        expiresAt: future(),
      });

      await expect(service.refresh('current.jwt.token')).rejects.toThrow(
        'already used',
      );
      expect(usersService.removeRefreshSession).not.toHaveBeenCalled();
    });

    it('revokes only that session when an old token is replayed', async () => {
      withSession({
        hash: sha256('newer.jwt.token'),
        prevHash: sha256('other.jwt.token'),
        rotatedAt: new Date(Date.now() - 10 * 60_000),
        expiresAt: future(),
      });

      await expect(service.refresh('current.jwt.token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.removeRefreshSession).toHaveBeenCalledWith(
        'user-1',
        's1',
      );
      expect(usersService.clearRefreshSessions).not.toHaveBeenCalled();
    });

    it('rejects a token from before sessions existed', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
      });
      await expect(service.refresh('legacy.jwt.token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.findByIdWithSessions).not.toHaveBeenCalled();
    });

    it('rejects a refresh token that fails JWT verification without a DB read', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('bad'));

      await expect(service.refresh('forged.token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.findByIdWithSessions).not.toHaveBeenCalled();
    });

    it('logs out one device when the session is known, all otherwise', async () => {
      await service.logout('user-1', 's1');
      expect(usersService.removeRefreshSession).toHaveBeenCalledWith(
        'user-1',
        's1',
      );
      await service.logout('user-1');
      expect(usersService.clearRefreshSessions).toHaveBeenCalledWith('user-1');
    });
  });

  describe('login', () => {
    it('returns the same error for an unknown email as for a wrong password', async () => {
      (usersService.findByEmailWithPassword as jest.Mock).mockResolvedValue(
        null,
      );
      const unknownEmail = service.login({
        email: 'nobody@b.com',
        password: 'secret123',
      } as never);
      await expect(unknownEmail).rejects.toThrow(UnauthorizedException);
      await expect(unknownEmail).rejects.toThrow('Invalid credentials');

      (usersService.findByEmailWithPassword as jest.Mock).mockResolvedValue(
        makeUser({ password: await bcrypt.hash('correct-password', 10) }),
      );
      const wrongPassword = service.login({
        email: 'a@b.com',
        password: 'wrong-password',
      } as never);
      // Identical message: otherwise the response reveals which emails exist.
      await expect(wrongPassword).rejects.toThrow('Invalid credentials');
    });

    it('tells a Google user to use Google instead of failing on the password', async () => {
      (usersService.findByEmailWithPassword as jest.Mock).mockResolvedValue(
        makeUser({ provider: 'google', password: 'random-hex' }),
      );

      await expect(
        service.login({ email: 'a@b.com', password: 'guess' } as never),
      ).rejects.toThrow(/Google/);
    });
  });

  describe('register', () => {
    it('rejects a duplicate email', async () => {
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(
        makeUser(),
      );
      await expect(
        service.register({
          email: 'a@b.com',
          username: 'ab',
          password: 'secret123',
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('signInWithGoogle', () => {
    it('gives a new Google account a 64-char random password, not Math.random()', async () => {
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(null);
      (usersService.create as jest.Mock).mockResolvedValue(
        makeUser({ provider: 'google' }),
      );

      await service.signInWithGoogle({
        email: 'g@b.com',
        firstName: 'G',
        lastName: 'B',
      });

      const [payload] = (usersService.create as jest.Mock).mock.calls[0];
      // 32 random bytes as hex. The old code used ~6 chars from Math.random().
      expect(payload.password).toHaveLength(64);
      expect(payload.provider).toBe('google');
    });

    it('refuses to sign a Google user in to a password account with the same email', async () => {
      // Pre-account takeover: someone registered this address with a password
      // before its real owner ever arrived. Signing the owner in to it would
      // hand the attacker a shared account.
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(
        makeUser({ provider: null }),
      );

      await expect(
        service.signInWithGoogle({ email: 'a@b.com' }),
      ).rejects.toBeInstanceOf(EmailRegisteredWithPasswordError);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('still signs in an account that was created through Google', async () => {
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(
        makeUser({ provider: 'google' }),
      );

      const tokens = await service.signInWithGoogle({ email: 'a@b.com' });
      expect(tokens.accessToken).toBeDefined();
    });
  });
});
