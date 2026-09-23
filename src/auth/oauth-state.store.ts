import { randomBytes, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

/** Cookie that carries the OAuth state nonce between the two legs of the flow. */
export const OAUTH_STATE_COOKIE = 'vnn_oauth_state';

/** Long enough to pick a Google account; short enough to be useless if lifted. */
const STATE_TTL_MS = 10 * 60 * 1000;

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (
  err: Error | null,
  ok: boolean,
  info?: { message: string },
) => void;

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * OAuth `state`, bound to the browser that started the sign-in.
 *
 * The Google strategy ran without any state at all, which leaves the callback
 * open to login CSRF: an attacker starts a sign-in with their own Google
 * account, stops before the callback, and gets a victim's browser to load that
 * callback URL. The victim is then signed in to the attacker's account, and
 * anything they save or write lands there.
 *
 * Passport's built-in stores need express-session, which this API does not use.
 * A signed token on its own is not enough either: it proves the server issued
 * the state, not that *this* browser asked for it, and an attacker can mint one
 * by starting their own flow. So the nonce goes into an httpOnly cookie when
 * the flow starts and must come back, byte for byte, as `state` on the callback.
 *
 * SameSite=Lax is what makes this work across the Google round trip: the
 * callback is a top-level GET navigation, for which Lax cookies are sent.
 */
export class CookieStateStore {
  constructor(private readonly secure: boolean) {}

  // Arity 3 is how passport-oauth2 decides which signature to call.
  store(req: Request, _meta: unknown, callback: StoreCallback): void {
    const nonce = randomBytes(24).toString('base64url');
    const res = (req as Request & { res?: Response }).res;
    if (!res) {
      callback(new Error('No response object to set the OAuth state cookie'));
      return;
    }
    res.cookie(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      maxAge: STATE_TTL_MS,
      path: '/auth/google',
    });
    callback(null, nonce);
  }

  verify(req: Request, provided: string, callback: VerifyCallback): void {
    const expected = readCookie(req, OAUTH_STATE_COOKIE);
    const res = (req as Request & { res?: Response }).res;
    // Single use: clear it whatever the outcome, so a state cannot be replayed.
    res?.clearCookie(OAUTH_STATE_COOKIE, { path: '/auth/google' });

    if (!expected || !provided || !sameString(expected, String(provided))) {
      callback(null, false, { message: 'Invalid OAuth state' });
      return;
    }
    callback(null, true);
  }
}
