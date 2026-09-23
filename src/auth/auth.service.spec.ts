import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
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
      findByIdWithRefreshToken: jest.fn(),
      setRefreshTokenHash: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
      findOne: jest.fn(),
      updateProfileFields: jest.fn(),
      buildUniqueUsername: jest.fn().mockResolvedValue('ab'),
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
      verifyAsync: jest.fn(),
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

  describe('refresh token storage', () => {
    it('stores a bcrypt HASH of the refresh token, never the token itself', async () => {
      // Drive token issuance through register, which needs no existing user.
      (usersService.findByEmailOrNull as jest.Mock).mockResolvedValue(null);
      (usersService.findByUsernameOrNull as jest.Mock).mockResolvedValue(null);
      (usersService.create as jest.Mock).mockResolvedValue(makeUser());

      await service.register({
        email: 'a@b.com',
        username: 'ab',
        password: 'secret123',
      } as never);

      const [, storedValue] = (usersService.setRefreshTokenHash as jest.Mock)
        .mock.calls.at(-1)!;

      // The regression this guards: the raw token used to be written straight
      // to the database, which also made bcrypt.compare always fail.
      expect(storedValue).not.toBe('signed.jwt.token');
      expect(storedValue).toMatch(/^\$2[aby]\$/);
      await expect(
        bcrypt.compare('signed.jwt.token', storedValue as string),
      ).resolves.toBe(true);
    });

    it('accepts a refresh token that matches the stored hash', async () => {
      const hash = await bcrypt.hash('signed.jwt.token', 10);
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
      });
      (usersService.findByIdWithRefreshToken as jest.Mock).mockResolvedValue(
        makeUser({ hashedRefreshToken: hash }),
      );

      await expect(service.refresh('signed.jwt.token')).resolves.toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'signed.jwt.token',
      });
    });

    it('revokes the session when a token does not match the stored hash', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.com',
      });
      (usersService.findByIdWithRefreshToken as jest.Mock).mockResolvedValue(
        makeUser({ hashedRefreshToken: await bcrypt.hash('other-token', 10) }),
      );

      await expect(service.refresh('signed.jwt.token')).rejects.toThrow(
        ForbiddenException,
      );
      // A replayed token means possible theft, so the session is cleared.
      expect(usersService.setRefreshTokenHash).toHaveBeenCalledWith(
        'user-1',
        null,
      );
    });

    it('rejects a refresh token that fails JWT verification without a DB read', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('bad'));

      await expect(service.refresh('forged.token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.findByIdWithRefreshToken).not.toHaveBeenCalled();
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
      usersService.findByEmailOrNull!.mockResolvedValue(
        makeUser({ provider: null }),
      );

      await expect(
        service.signInWithGoogle({ email: 'a@b.com' }),
      ).rejects.toBeInstanceOf(EmailRegisteredWithPasswordError);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('still signs in an account that was created through Google', async () => {
      usersService.findByEmailOrNull!.mockResolvedValue(
        makeUser({ provider: 'google' }),
      );

      const tokens = await service.signInWithGoogle({ email: 'a@b.com' });
      expect(tokens.accessToken).toBeDefined();
    });
  });
});
