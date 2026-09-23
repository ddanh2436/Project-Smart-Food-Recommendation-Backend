import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppService } from './app.service';
import { AdminGuard } from './common/guards/admin.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getRoot() {
    return this.appService.getInfo();
  }

  /**
   * Health probe for Render.
   *
   * Exempt from rate limiting: the platform polls it frequently and a 429 here
   * would be read as the service being down.
   */
  @SkipThrottle()
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  /**
   * Which address the rate limiter sees for this request.
   *
   * The only way to confirm TRUST_PROXY_HOPS is right on a given host: call it
   * from two different networks, and each should see its own public address.
   * If both see the same one, it is a proxy's, and the hop count is too low.
   * Admin-only, as it echoes the forwarding chain.
   */
  @UseGuards(AdminGuard)
  @Get('admin/client-ip')
  clientIp(@Req() req: Request) {
    return {
      ip: req.ip,
      ips: req.ips,
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      trustProxy: req.app.get('trust proxy'),
    };
  }
}
