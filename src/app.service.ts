import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

/** Mongoose readyState codes, for a readable health response. */
const MONGO_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

@Injectable()
export class AppService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
  ) {}

  getInfo() {
    return {
      name: 'VietNomNom API',
      version: process.env.npm_package_version ?? '0.0.1',
      docs: '/health',
    };
  }

  /**
   * Reports database connectivity and the configured AI service.
   *
   * The root route used to return the string 'Hello World!', which tells a
   * platform health check nothing — it stays "healthy" while the database is
   * unreachable.
   */
  getHealth() {
    const state = this.connection?.readyState ?? 0;
    return {
      status: state === 1 ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      database: {
        state: MONGO_STATES[state] ?? 'unknown',
        name: this.connection?.name,
      },
      aiServiceUrl: this.configService.get<string>('AI_SERVICE_URL'),
      timestamp: new Date().toISOString(),
    };
  }
}
