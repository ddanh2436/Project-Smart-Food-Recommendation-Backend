import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load .env.local first so a developer can override the shared .env
      // without editing it.
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        // Fail a request in 10s rather than hanging for the 30s default when
        // Atlas is unreachable (usually a missing IP allow-list entry).
        serverSelectionTimeoutMS: 10_000,
        // Render's free tier sleeps; a bounded pool avoids piling up sockets
        // across wake-ups.
        maxPoolSize: 10,
        minPoolSize: 1,
        retryWrites: true,
      }),
    }),

    /**
     * Global rate limiting. The API previously had none, so review posting and
     * login were both freely scriptable.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),

    UsersModule,
    AuthModule,
    RestaurantsModule,
    ReviewsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
