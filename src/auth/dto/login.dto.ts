import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  /**
   * Deliberately no MinLength here. Registration enforces the password policy;
   * repeating it on login only rejects existing accounts created under an older
   * policy, and tells an attacker what the policy is.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}
