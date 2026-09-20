import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * The decorators here were previously misaligned: `@IsUrl()` sat directly above
 * `firstName`, so any registration whose first name was not a URL was rejected
 * with a validation error, while `picture` — the field that actually holds a
 * URL — had no decorators at all and was therefore stripped by the whitelisting
 * ValidationPipe.
 */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/^[\w.-]+$/, {
    message:
      'Username may only contain letters, numbers, dots, dashes and underscores',
  })
  username: string;

  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  picture?: string;
}
