import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * The Google callback, without the bare 401.
 *
 * A failed state check or an unverified Google email makes Passport reject the
 * callback, and the stock guard answers with a JSON 401 on the API's own domain
 * -- a dead end for someone who just picked an account on Google's page. This
 * lets the request through with no user instead, and the controller sends the
 * browser back to the sign-in page with an error it can show.
 */
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  handleRequest<TUser>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
