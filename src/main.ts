import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  /**
   * Fail fast on missing configuration.
   *
   * Without this the app booted happily with no MONGODB_URI and only fell over
   * on the first request, which on Render looks like a healthy deploy serving
   * 500s. The old startup instead printed every environment variable — including
   * secrets — straight into the logs.
   */
  const required = ['MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !config.get<string>(key));
  if (missing.length > 0) {
    logger.error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See .env.example.`,
    );
    process.exit(1);
  }
  if (config.get<string>('JWT_SECRET') === config.get<string>('JWT_REFRESH_SECRET')) {
    logger.error(
      'JWT_SECRET and JWT_REFRESH_SECRET must differ, otherwise an access ' +
        'token is accepted as a refresh token.',
    );
    process.exit(1);
  }

  /**
   * Trust the platform's proxy, so `req.ip` is the client and not the proxy.
   *
   * Render terminates connections at its own proxy, so without this every
   * request arrived from the proxy's address. The rate limiter keys on
   * `req.ip`, which made each limit one bucket shared by the whole site: the
   * global 120 requests a minute covered every visitor at once (a home page
   * load alone makes about ten calls), and ten failed logins by anyone locked
   * every user out of signing in.
   *
   * The value is a hop count, not `true`. `true` would believe the leftmost
   * X-Forwarded-For entry, which the client writes itself, and anyone could
   * then pick a fresh "IP" per request and walk straight past the limits.
   * Trusting exactly the hops the platform adds takes the address the nearest
   * trusted proxy saw. Check the result with GET /admin/client-ip after a
   * deploy, and raise TRUST_PROXY_HOPS if it still shows a proxy address.
   */
  const hops = Number(config.get<string>('TRUST_PROXY_HOPS') ?? '1');
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);

  app.use(helmet());
  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties with no decorator on the DTO. Without this, extra
      // fields in a request body flowed into Mongoose updates — a
      // mass-assignment hole (e.g. posting `hashedRefreshToken`).
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      /**
       * Implicit conversion is OFF on purpose.
       *
       * It converts a query string to the property's reflected type, and for a
       * boolean that means `Boolean('false')` -- which is `true`. So
       * `?openNow=false` arrived as `true`, silently switching the restaurant
       * listing into its open-now path: the page count dropped from 179 to 42
       * and 4,366 restaurants became unreachable. `?openNow=0` did the same.
       *
       * Every DTO that needs coercion declares it explicitly with `@Type()`
       * or `@Transform()`, which is both safer and visible at the field.
       */
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  /**
   * CORS from an explicit allow-list.
   *
   * `origin: '*'` together with `credentials: true` is invalid per the CORS
   * spec — browsers reject the response outright — so the previous config was
   * simultaneously wide open and broken for credentialed requests.
   */
  const allowedOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const frontendUrl = config.get<string>('FRONTEND_URL');
  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl.replace(/\/+$/, ''));
  }

  app.enableCors({
    origin: (origin, callback) => {
      // Requests with no Origin header (curl, server-to-server, same-origin
      // navigations) are not subject to CORS, so allow them through.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
        return callback(null, true);
      }
      // Vercel preview deployments get a new hostname per commit, so match the
      // project's preview pattern rather than listing every one.
      if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86_400,
  });

  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 3001;
  // Bind to 0.0.0.0 explicitly: Render routes traffic to the container's
  // external interface, not to localhost.
  await app.listen(port, '0.0.0.0');

  logger.log(`Listening on port ${port}`);
  logger.log(`AI service: ${config.get<string>('AI_SERVICE_URL')}`);
  logger.log(`Allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);
}

void bootstrap();
