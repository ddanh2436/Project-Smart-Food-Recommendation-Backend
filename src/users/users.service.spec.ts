import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getModelToken } from '@nestjs/mongoose';
import { User } from './schemas/user.schema';
import { NotFoundException } from '@nestjs/common';
import mongoose from 'mongoose';

describe('UsersService', () => {
  let service: UsersService;
  let userModel: any;

  // Mock dữ liệu user mẫu
  const mockUser = {
    _id: new mongoose.Types.ObjectId('64c9e782650742a7b8e5d2b1'),
    email: 'test@example.com',
    password: 'hashedPassword',
    firstName: 'Test',
    lastName: 'User',
    save: jest.fn(),
  };

  // Mock Model Mongoose
  const mockUserModel = {
    new: jest.fn().mockResolvedValue(mockUser),
    constructor: jest.fn().mockImplementation(() => mockUser),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: mockUserModel,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userModel = module.get(getModelToken(User.name));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- TEST CREATE ---
  describe('create', () => {
    it('should create a new user successfully', async () => {
      const createUserDto = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      };
      
      mockUser.save.mockResolvedValue(mockUser);
      jest.spyOn(userModel, 'constructor' as any).mockReturnValue(mockUser);
      service = new UsersService(
        class MockModel {
          constructor(public data: any) {}
          save = jest.fn().mockResolvedValue(mockUser);
        } as any
      );

      const result = await service.create(createUserDto as any);
      expect(result).toEqual(mockUser);
    });
  });

  // --- TEST FIND ONE ---
  describe('findOne', () => {
    it('should return a user if found', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.findOne(mockUser._id.toString());
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if id is invalid', async () => {
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.findOne(mockUser._id.toString())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // --- TEST FIND ONE BY EMAIL ---
  describe('findOneByEmail', () => {
    it('should return a user if email exists', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.findOneByEmail('test@example.com');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException if email does not exist', async () => {
      mockUserModel.findOne.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.findOneByEmail('notfound@example.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // --- TEST UPDATE ---
  describe('update', () => {
    it('should update and return the user', async () => {
      const updateUserDto = { firstName: 'Updated' };
      const updatedUser = { ...mockUser, ...updateUserDto };

      mockUserModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(updatedUser),
      });

      const result = await service.update(
        mockUser._id.toString(),
        updateUserDto as any,
      );
      expect(result).toEqual(updatedUser);
    });
  });

  // --- TEST REMOVE ---
  describe('remove', () => {
    it('should delete and return the user', async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockUser),
      });

      const result = await service.remove(mockUser._id.toString());
      expect(result).toEqual(mockUser);
    });
  });
});