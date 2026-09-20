import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

/** Fields a user is ever allowed to change about themselves. */
const EDITABLE_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'company',
  'designation',
  'bio',
  'picture',
] as const;

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(
    createUserDto: CreateUserDto & { provider?: string | null },
  ): Promise<UserDocument> {
    try {
      return await new this.userModel(createUserDto).save();
    } catch (error: any) {
      // A unique-index violation is a client error, not a 500.
      if (error?.code === 11000) {
        const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
        throw new BadRequestException(`That ${field} is already in use`);
      }
      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<UserDocument> {
    this.assertValidId(id);
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  /**
   * Look up by email without throwing when absent.
   *
   * The old `findOneByEmail` threw NotFoundException, which forced every caller
   * to wrap it in try/catch and made "email not registered" observable as a 404
   * during login.
   */
  async findByEmailOrNull(email: string): Promise<UserDocument | null> {
    if (!email) return null;
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async findByUsernameOrNull(username: string): Promise<UserDocument | null> {
    if (!username) return null;
    return this.userModel.findOne({ username: username.trim() }).exec();
  }

  /** Includes the password hash; only for the login flow. */
  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    if (!email) return null;
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+password')
      .exec();
  }

  /** Includes the refresh-token hash; only for the refresh flow. */
  async findByIdWithRefreshToken(id: string): Promise<UserDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).select('+hashedRefreshToken').exec();
  }

  async setRefreshTokenHash(
    userId: string,
    hash: string | null,
  ): Promise<void> {
    this.assertValidId(userId);
    await this.userModel
      .findByIdAndUpdate(userId, { hashedRefreshToken: hash })
      .exec();
  }

  /**
   * Update only the whitelisted profile fields.
   *
   * Passing the DTO straight into `findByIdAndUpdate` was a mass-assignment
   * risk: the global ValidationPipe did not strip unknown properties, so a
   * request body carrying `password` or `hashedRefreshToken` would have been
   * written through to the document.
   */
  async updateProfileFields(
    userId: string,
    updateUserDto: UpdateUserDto & { picture?: string },
  ): Promise<UserDocument> {
    this.assertValidId(userId);

    const update: Record<string, unknown> = {};
    for (const field of EDITABLE_PROFILE_FIELDS) {
      const value = (updateUserDto as Record<string, unknown>)[field];
      if (value !== undefined) {
        update[field] = value;
      }
    }

    if (Object.keys(update).length === 0) {
      return this.findOne(userId);
    }

    const updated = await this.userModel
      .findByIdAndUpdate(userId, update, { new: true, runValidators: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return updated;
  }

  async remove(id: string): Promise<{ success: boolean }> {
    this.assertValidId(id);
    const deleted = await this.userModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return { success: true };
  }

  /** Append a numeric suffix until the username is free. */
  async buildUniqueUsername(base: string): Promise<string> {
    const seed = (base || 'user').replace(/[^\w.-]/g, '').slice(0, 24) || 'user';
    if (!(await this.findByUsernameOrNull(seed))) {
      return seed;
    }
    for (let suffix = 1; suffix <= 999; suffix += 1) {
      const candidate = `${seed}${suffix}`;
      if (!(await this.findByUsernameOrNull(candidate))) {
        return candidate;
      }
    }
    return `${seed}${Date.now()}`;
  }

  private assertValidId(id: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid id format: ${id}`);
    }
  }
}
