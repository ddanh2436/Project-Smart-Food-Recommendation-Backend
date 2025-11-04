import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import * as bcrypt from 'bcrypt'; // 1. Import bcrypt

export type UserDocument = HydratedDocument<User>;

@Schema({
  // 2. Thêm timestamps và toJSON/toObject
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function (doc, ret: any) {
      // Xóa password và hashedRefreshToken khỏi kết quả JSON trả về
      delete ret.password;
      delete ret.hashedRefreshToken;
      delete ret._id; // (Tùy chọn, nếu bạn dùng virtual 'id')
      delete ret.__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
    transform: function (doc, ret: any) {
      delete ret.password;
      delete ret.hashedRefreshToken;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true })
  username: string;

  @Prop({ required: true, unique: true }) // Thêm unique cho email
  email: string;

  @Prop({ required: true })
  password: string;

  // 3. Thêm trường lưu refresh token đã băm
  @Prop({ required: false }) // Không bắt buộc
  picture?: string;
  hashedRefreshToken?: string;

  @Prop({ required: false })
  firstName: string;

  @Prop({ required: false })
  lastName: string;

  @Prop({ required: false })
  phone?: string;

  @Prop({ required: false })
  company?: string;

  @Prop({ required: false })
  designation?: string; // Chức vụ

  @Prop({ required: false })
  bio?: string; // Tiểu sử
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre<UserDocument>('save', async function (next) {
  // Chỉ băm mật khẩu nếu nó vừa được thay đổi (hoặc là user mới)
  if (!this.isModified('password')) {
    return next();
  }

  // Băm mật khẩu
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
