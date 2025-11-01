// src/users/dto/create-user.dto.ts

// Chúng ta sẽ dùng class-validator để xác thực dữ liệu
// Chạy: npm install class-validator class-transformer
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}