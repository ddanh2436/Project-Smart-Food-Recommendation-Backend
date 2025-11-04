// src/users/dto/create-user.dto.ts

import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  IsUrl,
} from 'class-validator'; // 1. Thêm IsOptional, IsUrl

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

  // --- 2. THÊM 3 DÒNG NÀY ---
  @IsOptional() // Tùy chọn (không bắt buộc)
  @IsUrl() // Đảm bảo nó là một URL (nếu có)
  @IsOptional()
  @IsString()
  firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  picture?: string;
}
