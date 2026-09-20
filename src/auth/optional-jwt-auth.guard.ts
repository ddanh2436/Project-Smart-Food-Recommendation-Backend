import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Attaches `req.user` when a valid token is present, but allows the request
 * through when there is none.
 *
 * Used for endpoints that work anonymously yet should attribute the action when
 * the caller happens to be signed in.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    // Returning the falsy user instead of throwing is what makes auth optional.
    return user;
  }
}
