import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  type: 'access';
}

@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException();

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      if (payload.type !== 'access') throw new UnauthorizedException();
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }

  private extractToken(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return null;
  }
}
