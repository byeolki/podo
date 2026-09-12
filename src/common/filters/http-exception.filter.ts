import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * `?token=` is accepted on every route, because `<audio>` and `<img>` cannot set
 * an Authorization header. That means the URL carries a live 15-minute access
 * token — so it must never be logged verbatim or echoed back in an error body,
 * which is where container logs and browser consoles pick it up.
 */
function redact(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, '$1[redacted]');
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  /**
   * @param spaIndexHtml Contents of the web frontend's `index.html`, or null
   * if no frontend build is present. When set, unmatched non-API GET/HEAD
   * requests that fall through to Nest's default 404 are served this SPA
   * shell instead of a JSON error, so client-side routes resolve correctly.
   */
  constructor(private readonly spaIndexHtml: string | null = null) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (
      status === HttpStatus.NOT_FOUND &&
      this.spaIndexHtml !== null &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !redact(request.url).split('?')[0].startsWith('/api/')
    ) {
      return reply.status(200).type('text/html').send(this.spaIndexHtml);
    }

    const message = isHttp
      ? (exception.getResponse() as { message?: string } | string)
      : 'Internal server error';

    const body = typeof message === 'string' ? { message } : message;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${redact(request.url)} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(`${request.method} ${redact(request.url)} → ${status}: ${JSON.stringify(body)}`);
    }

    reply.status(status).send({
      statusCode: status,
      ...(typeof body === 'string' ? { message: body } : body),
      timestamp: new Date().toISOString(),
      path: redact(request.url),
    });
  }
}
