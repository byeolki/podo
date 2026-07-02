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
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const trustProxy = process.env.TRUST_PROXY !== 'false';
  const adapter = new FastifyAdapter({ logger: false, trustProxy });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  const config = app.get(ConfigService);

  if (
    process.env.NODE_ENV === 'production' &&
    config.get<string>('jwt_secret') === 'dev-secret-change-in-production'
  ) {
    throw new Error('JWT_SECRET must be set in production');
  }

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
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
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
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
