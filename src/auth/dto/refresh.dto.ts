import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
  /**
   * Only the token is needed. The endpoint used to also take a `userId` from
   * the body and trust it; the user id now comes from the token's verified
   * payload, so a caller cannot ask to refresh someone else's session.
   */
  @IsString()
  @IsNotEmpty()
  @IsJWT()
  refreshToken: string;
}
