import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  RefreshSession,
  User,
  UserDocument,
} from './schemas/user.schema';

/** Fields a user is ever allowed to change about themselves. */
const EDITABLE_PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'phone',
  'company',
  'designation',
  'bio',
  'picture',
  'fullName',
  'homeCity',
  'favoriteTags',
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

  /** Includes the password hash; only for changing the password. */
  async findByIdWithPassword(id: string): Promise<UserDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).select('+password').exec();
  }

  /** Set a new password; the schema's pre-save hook hashes it. */
  async setPassword(userId: string, password: string): Promise<void> {
    const user = await this.findByIdWithPassword(userId);
    if (!user) throw new NotFoundException(`User #${userId} not found`);
    user.password = password;
    await user.save();
  }

  /** Sign out every device except `keepSid` (all of them when it is unknown). */
  async removeOtherRefreshSessions(userId: string, keepSid?: string): Promise<void> {
    this.assertValidId(userId);
    if (!keepSid) return this.clearRefreshSessions(userId);
    await this.userModel
      .updateOne(
        { _id: userId },
        { $pull: { refreshSessions: { sid: { $ne: keepSid } } } },
      )
      .exec();
  }

  /** Includes the per-device sessions; only for the refresh flow. */
  async findByIdWithSessions(id: string): Promise<UserDocument | null> {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    return this.userModel.findById(id).select('+refreshSessions').exec();
  }

  /**
   * Record a new signed-in device, keeping the newest `max`. The oldest device
   * is the one signed out when the limit is reached, which is also the one
   * most likely to be forgotten or lost.
   */
  async addRefreshSession(
    userId: string,
    session: RefreshSession,
    max = 5,
  ): Promise<void> {
    this.assertValidId(userId);
    await this.userModel
      .updateOne(
        { _id: userId },
        {
          $push: { refreshSessions: { $each: [session], $slice: -max } },
          $unset: { hashedRefreshToken: 1 },
        },
      )
      .exec();
  }

  /**
   * Swap a session's token for the next one, only if it still holds `oldHash`.
   *
   * The condition is what makes rotation safe under concurrency: two requests
   * presenting the same token can both pass a read-then-write check, and each
   * would hand out a valid successor. Here only one update can match.
   */
  async rotateRefreshSession(
    userId: string,
    sid: string,
    oldHash: string,
    newHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    this.assertValidId(userId);
    const result = await this.userModel
      .updateOne(
        { _id: userId, refreshSessions: { $elemMatch: { sid, hash: oldHash } } },
        {
          $set: {
            'refreshSessions.$.hash': newHash,
            'refreshSessions.$.prevHash': oldHash,
            'refreshSessions.$.rotatedAt': new Date(),
            'refreshSessions.$.expiresAt': expiresAt,
          },
        },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async removeRefreshSession(userId: string, sid: string): Promise<void> {
    this.assertValidId(userId);
    await this.userModel
      .updateOne({ _id: userId }, { $pull: { refreshSessions: { sid } } })
      .exec();
  }

  /** Sign out every device. */
  async clearRefreshSessions(userId: string): Promise<void> {
    this.assertValidId(userId);
    await this.userModel
      .updateOne(
        { _id: userId },
        { $unset: { refreshSessions: 1, hashedRefreshToken: 1 } },
      )
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
