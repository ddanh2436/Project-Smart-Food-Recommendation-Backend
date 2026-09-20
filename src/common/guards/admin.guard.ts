import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret guard for maintenance endpoints.
 *
 * Callers send the secret in an `x-admin-token` header. It fails closed: if
 * ADMIN_TOKEN is not configured the endpoint is unavailable rather than open,
 * so a forgotten environment variable cannot expose it.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('ADMIN_TOKEN');
    if (!expected) {
      throw new ServiceUnavailableException(
        'ADMIN_TOKEN is not configured on this server',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-admin-token'];
    const token = Array.isArray(provided) ? provided[0] : provided;

    if (!token || !this.safeEqual(token, expected)) {
      throw new UnauthorizedException('Invalid admin token');
    }
    return true;
  }

  /** Constant-time comparison, so response timing reveals nothing. */
  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
}
