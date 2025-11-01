// src/users/schemas/user.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// Export kiểu Document để có thể dùng trong service
export type UserDocument = HydratedDocument<User>;

@Schema() // Đánh dấu đây là một Schema
export class User {
  @Prop({ required: true, unique: true }) // Đánh dấu là 1 trường (property)
  username: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  password: string; // Lưu ý: Thực tế nên băm (hash) mật khẩu này
}

// Tạo Schema thực tế từ Class
export const UserSchema = SchemaFactory.createForClass(User);