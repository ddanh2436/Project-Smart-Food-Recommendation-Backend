import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto'; // 1. Import DTO này
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import mongoose, { Model } from 'mongoose'; // 2. Import mongoose (sửa lại)

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const createdUser = new this.userModel(createUserDto);
    return createdUser.save();
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  // 3. THÊM HÀM NÀY
  async findOne(id: string): Promise<UserDocument> {
    // Kiểm tra xem ID có đúng định dạng ObjectId của Mongo không
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  // 4. THÊM HÀM NÀY
  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    // findByIdAndUpdate sẽ tìm, cập nhật và trả về bản ghi MỚI (vì có { new: true })
    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return updatedUser;
  }

  // 5. THÊM HÀM NÀY
  async remove(id: string): Promise<UserDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid ID format: ${id}`);
    }
    const deletedUser = await this.userModel.findByIdAndDelete(id).exec();
    if (!deletedUser) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return deletedUser;
  }

  async findOneByEmail(email: string): Promise<UserDocument> {
    // .select('+password') RẤT QUAN TRỌNG để lấy cả mật khẩu
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }
    return user;
  }

  async updateRefreshToken(userId: string, refreshToken: string | null) {
    // Lưu ý: refreshToken đã được băm ở auth.service trước khi gọi hàm này
    return this.userModel.findByIdAndUpdate(userId, {
      hashedRefreshToken: refreshToken,
    });
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto): Promise<User> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new NotFoundException(`Invalid ID format`);
    }
    
    const updatedUser = await this.userModel
      .findByIdAndUpdate(userId, updateUserDto, { new: true }) // { new: true } để trả về data MỚI
      .exec();
      
    if (!updatedUser) {
      throw new NotFoundException(`User #${userId} not found`);
    }
    return updatedUser;
  }
}
