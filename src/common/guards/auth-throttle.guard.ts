import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';

const WINDOW_MS = 60_000;

@Injectable()
export class AuthThrottleGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;

  constructor(config: ConfigService) {
    this.max = config.get<number>('auth_rate_limit_max', 10);
    setInterval(() => this.prune(), WINDOW_MS).unref();
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const key = req.ip ?? 'unknown';
    const now = Date.now();

    const timestamps = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (timestamps.length >= this.max) {
      throw new HttpException('Too many requests, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return true;
  }

  private prune() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits) {
      const alive = timestamps.filter((t) => now - t < WINDOW_MS);
      if (alive.length === 0) this.hits.delete(key);
      else this.hits.set(key, alive);
    }
  }
}
