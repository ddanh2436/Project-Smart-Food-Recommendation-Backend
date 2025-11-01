// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { MongooseModule } from '@nestjs/mongoose'; // 1. Import MongooseModule
import { User, UserSchema } from './schemas/user.schema'; // 2. Import Schema

@Module({
  imports: [
    // 3. Đăng ký Schema
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}