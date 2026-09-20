import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

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
}
