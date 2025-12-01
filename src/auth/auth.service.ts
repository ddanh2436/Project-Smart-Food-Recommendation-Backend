// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserDocument } from 'src/users/schemas/user.schema'; // Import thêm UserDocument
import { UpdateUserDto } from 'src/users/dto/update-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  // --- HÀM ĐĂNG KÝ ---
  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService
      .findOneByEmail(registerDto.email)
      .catch(() => null);

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const newUser: UserDocument = await this.usersService.create(registerDto);

    // Tạo tokens
    const tokens = await this._generateTokens(
      newUser._id.toString(), // SỬA Ở ĐÂY 1/6
      newUser.email,
    );

    // Cập nhật refresh token đã băm vào DB
    await this.usersService.updateRefreshToken(
      newUser._id.toString(), // SỬA Ở ĐÂY 2/6
      tokens.refreshToken,
    );

    return tokens;
  }

  // --- HÀM ĐĂNG NHẬP ---
  async login(loginDto: LoginDto) {
    // 1. Tìm user bằng email
    const user: UserDocument = await this.usersService.findOneByEmail(
      loginDto.email,
    );

    // 2. So sánh mật khẩu
    const isMatch = await bcrypt.compare(loginDto.password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Tạo tokens
    const tokens = await this._generateTokens(
      user._id.toString(), // SỬA Ở ĐÂY 3/6
      user.email,
    );

    // 4. Cập nhật refresh token đã băm
    await this.usersService.updateRefreshToken(
      user._id.toString(), // SỬA Ở ĐÂY 4/6
      tokens.refreshToken,
    );

    return tokens;
  }

  // --- HÀM ĐĂNG XUẤT ---
  async logout(userId: string) {
    return this.usersService.updateRefreshToken(userId, null);
  }

  // --- HÀM LÀM MỚI TOKEN ---
  async refresh(userId: string, refreshToken: string) {
    const user: UserDocument = await this.usersService.findOne(userId); // Giả định findOne trả về UserDocument
    if (!user || !user.hashedRefreshToken) {
      throw new ForbiddenException('Access Denied');
    }

    const isMatch = await bcrypt.compare(refreshToken, user.hashedRefreshToken);
    if (!isMatch) {
      throw new ForbiddenException('Access Denied');
    }

    // Tạo tokens mới
    const tokens = await this._generateTokens(
      user._id.toString(), // SỬA Ở ĐÂY 5/6
      user.email,
    );
    // Cập nhật token mới vào DB
    await this.usersService.updateRefreshToken(
      user._id.toString(), // SỬA Ở ĐÂY 6/6
      tokens.refreshToken,
    );

    return tokens;
  }

  // --- HÀM PRIVATE: Băm dữ liệu ---
  private async _hashData(data: string): Promise<string> {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(data, salt);
  }

  // --- HÀM PRIVATE: Tạo Tokens ---
  private async _generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async signInWithGoogle(googleUser: {
    email: string;
    firstName: string;
    lastName: string;
    picture?: string;
  }) {
    if (!googleUser) {
      throw new BadRequestException('Unauthenticated');
    }

    let user: UserDocument;

    try {
      // 1. Thử tìm user bằng email
      user = await this.usersService.findOneByEmail(googleUser.email);

      // === BỔ SUNG LOGIC CẬP NHẬT TẠI ĐÂY ===
      // Nếu user đã tồn tại, kiểm tra xem có cần cập nhật avatar từ Google không
      if (googleUser.picture && user.picture !== googleUser.picture) {
        user = await this.usersService.update(user._id.toString(), {
          picture: googleUser.picture,
        } as any); // Cast 'as any' hoặc đảm bảo UpdateUserDto có trường 'picture'
      }
      // =======================================

    } catch (error) {
      // 2. Nếu không tìm thấy (NotFoundException), thì tạo user mới
      if (error.status === 404) {
        user = await this.usersService.create({
          email: googleUser.email,
          username: googleUser.email.split('@')[0],
          firstName: googleUser.firstName,
          lastName: googleUser.lastName,
          picture: googleUser.picture,
          password: Math.random().toString(36).substring(7),
        } as any); // Cast 'as any' nếu CreateUserDto báo lỗi thiếu trường
      } else {
        throw error;
      }
    }

    // 3. Tạo JWT (giữ nguyên code cũ)
    const tokens = await this._generateTokens(user._id.toString(), user.email);
    
    // ... phần còn lại giữ nguyên
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      tokens.refreshToken,
    );

    return tokens;
  }

  async getProfile(userId: string) {
    const user = await this.usersService.findOne(userId);
    return user;
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto) {
    // Chúng ta chỉ gọi hàm từ UsersService
    return this.usersService.updateProfile(userId, updateUserDto);
  }
}
