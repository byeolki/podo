import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from './jwt-auth.guard';
import { FastifyRequest } from 'fastify';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    if (!req.user) throw new ForbiddenException();
    if (!requiredRoles.includes(req.user.role)) throw new ForbiddenException();
    return true;
  }
}
