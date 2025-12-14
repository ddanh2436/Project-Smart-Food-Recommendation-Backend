import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';

// [QUAN TRỌNG] Mock bcrypt trực tiếp để tránh lỗi runtime khi test
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
  genSalt: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockUser = {
    _id: '64c9e782650742a7b8e5d2b1',
    email: 'test@example.com',
    password: 'hashedPassword',
    hashedRefreshToken: 'hashedToken',
  };

  const mockUsersService = {
    findOneByEmail: jest.fn(),
    create: jest.fn(),
    updateRefreshToken: jest.fn(),
    findOne: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'secret';
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- TEST REGISTER ---
  describe('register', () => {
    const registerDto = {
      email: 'new@example.com',
      password: 'password',
      username: 'newuser',
      firstName: 'New',
      lastName: 'User',
    };

    it('should register a new user successfully', async () => {
      mockUsersService.findOneByEmail.mockRejectedValue(new Error('Not found'));
      mockUsersService.create.mockResolvedValue(mockUser);
      mockJwtService.signAsync.mockResolvedValue('token_string');
      
      const result = await service.register(registerDto);

      expect(mockUsersService.create).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should throw BadRequestException if email already exists', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue(mockUser);
      await expect(service.register(registerDto)).rejects.toThrow(BadRequestException);
    });
  });

  // --- TEST LOGIN ---
  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' };

    it('should return tokens if credentials are valid', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true); // Mock pass đúng
      mockJwtService.signAsync.mockResolvedValue('token_string');

      const result = await service.login(loginDto);
      expect(result).toHaveProperty('accessToken');
    });

    it('should throw UnauthorizedException if password is incorrect', async () => {
      mockUsersService.findOneByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false); // Mock pass sai

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  // --- TEST REFRESH ---
  describe('refresh', () => {
    it('should return new tokens if refresh token is valid', async () => {
      mockUsersService.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.signAsync.mockResolvedValue('new_token');

      const result = await service.refresh('uid', 'rt');
      expect(result).toHaveProperty('accessToken');
    });

    it('should throw ForbiddenException if user not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);
      await expect(service.refresh('uid', 'rt')).rejects.toThrow(ForbiddenException);
    });
  });
});