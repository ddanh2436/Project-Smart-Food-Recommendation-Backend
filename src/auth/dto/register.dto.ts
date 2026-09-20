import { PickType } from '@nestjs/mapped-types';
import { CreateUserDto } from 'src/users/dto/create-user.dto';

/**
 * Derived from CreateUserDto so the password and username rules are defined
 * exactly once. Previously this extended LoginDto and added `username`, which
 * meant registration silently used the *login* password rule (min 6) instead of
 * the stricter one on CreateUserDto.
 */
export class RegisterDto extends PickType(CreateUserDto, [
  'username',
  'email',
  'password',
] as const) {}
