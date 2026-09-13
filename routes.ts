import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './src/app.module';
(async () => {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.init();
  const server = app.getHttpAdapter().getInstance();
  const routes = (server as any).printRoutes({ commonPrefix: false });
  console.log(routes);
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('BOOT FAILED:', e.message); process.exit(1); });
