import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import fastifyMultipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('Bootstrap');

/** How long a redeploy waits for in-flight responses before exiting regardless. */
const SHUTDOWN_GRACE_MS = 12_000;

process.on('unhandledRejection', (reason) => {
  logger.error(
    `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason.stack : undefined,
  );
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`, err.stack);
});

async function bootstrap() {
  // Read straight from the environment rather than ConfigService: the Fastify
  // adapter has to be constructed before the Nest app (and therefore before the
  // DI container) exists.
  const trustProxy = process.env.TRUST_PROXY !== 'false';
  const adapter = new FastifyAdapter({ logger: false, trustProxy });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  const config = app.get(ConfigService);

  // Every placeholder that has ever appeared in this repo, not just the one in
  // `configuration.ts`: the root compose file defaults to
  // `change-me-in-production`, which the guard did not know about — so
  // `docker compose up` with no JWT_SECRET exported started a server signing
  // tokens with a secret published in the repository.
  const PUBLISHED_SECRETS = new Set([
    'dev-secret-change-in-production',
    'change-me-in-production',
    'changeme',
    '',
  ]);
  const secret = config.get<string>('jwt_secret', '');
  if (process.env.NODE_ENV === 'production' && PUBLISHED_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET is unset or still a placeholder. Generate one: openssl rand -hex 32',
    );
  }
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET is too short — use at least 32 characters');
  }

  // Serve the web frontend build (SPA). `wildcard: false` registers one exact
  // route per file found in `staticDir` instead of a catch-all, so any request
  // that doesn't match a real asset (API routes, client-side SPA routes) falls
  // through to Nest's default not-found handling, where GlobalExceptionFilter
  // rewrites it to the SPA's index.html for non-API GET requests. Fastify only
  // allows one `setNotFoundHandler` per instance and Nest already claims that
  // slot, so the fallback is implemented in the exception filter instead.
  const staticDir = path.resolve(config.get<string>('static_dir', path.join(process.cwd(), 'web', 'dist')));
  const indexPath = path.join(staticDir, 'index.html');
  const spaIndexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : null;

  if (fs.existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });

    // @fastify/static computes its own default Cache-Control header inside the
    // route handler itself, so a `setHeaders` callback gets clobbered right
    // after it runs. An onSend hook runs later in the lifecycle and can safely
    // override it for hashed, long-cacheable build assets.
    app.getHttpAdapter().getInstance().addHook('onSend', (req, reply, payload, done) => {
      const url = req.url.split('?')[0];
      if (url.endsWith('.js') || url.endsWith('.css')) {
        reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
      done(null, payload);
    });
  }

  app.useGlobalFilters(new GlobalExceptionFilter(spaIndexHtml));
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // A full library listing is the biggest response this server sends and it's
  // almost entirely repeated JSON keys, so it compresses roughly 10:1. Media is
  // excluded: audio/video are already compressed, and gzipping a stream would
  // break byte-range seeking.
  await app.register(fastifyCompress, {
    global: true,
    threshold: 1024,
    encodings: ['br', 'gzip', 'deflate'],
    customTypes: /^application\/json|^text\//,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // web/index.html pulls Inter from Google Fonts: the stylesheet comes from
        // fonts.googleapis.com and the font files it references from fonts.gstatic.com.
        // Overriding styleSrc drops helmet's permissive default, so both hosts have to
        // be named explicitly or the page silently falls back to the system font.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(fastifyRateLimit, {
    max: config.get<number>('rate_limit_max', 1000),
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health',
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 500 * 1024 * 1024, files: 20 },
  });

  app.enableCors({
    origin: config.get<string>('cors_origin', '*'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-Cache', 'X-Podo-Delivery'],
  });

  if (config.get<boolean>('swagger_enabled', true)) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Podo API')
      .setDescription('Self-hosted music streaming server API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('port', 3000);
  const host = config.get<string>('host', '0.0.0.0');

  // Without this a redeploy kills every request mid-flight: Node's default
  // SIGTERM handling ends the process immediately, so an audio response in
  // progress is cut off rather than finished. Browsers fetch audio in ranges, so
  // a short grace period is enough for almost all of them to complete — and the
  // player then re-requests the next range against whatever is serving by then.
  // Bounded, because a request that never ends must not hold the deploy open.
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — finishing in-flight requests`);
    const forced = setTimeout(() => {
      logger.warn('Grace period elapsed with requests still open; exiting anyway');
      process.exit(0);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();
    try {
      await app.close();
    } finally {
      clearTimeout(forced);
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen(port, host);
  logger.log(`Server running at http://${host}:${port}`);
  if (config.get<boolean>('swagger_enabled', true)) {
    logger.log(`API docs: http://${host}:${port}/api/docs`);
  }
}

bootstrap().catch((err: Error) => {
  logger.error('Failed to start server', err.stack);
  process.exit(1);
});
