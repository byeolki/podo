import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { FastifyRequest } from 'fastify';

/** Same reason as the exception filter: the URL can carry an access token. */
function redact(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          if (ms > 1000) {
            this.logger.warn(`${method} ${url} +${ms}ms`);
          }
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.debug(`${method} ${url} +${ms}ms [error]`);
        },
      }),
    );
  }
}
