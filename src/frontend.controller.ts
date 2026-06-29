import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Public } from './common/decorators/public.decorator';
import * as path from 'path';
import * as fs from 'fs';

@Public()
@Controller()
export class FrontendController {
  private readonly indexHtml: string | null = null;

  constructor(config: ConfigService) {
    const staticDir = config.get<string>('static_dir', path.join(process.cwd(), 'public'));
    const indexPath = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      this.indexHtml = fs.readFileSync(indexPath, 'utf-8');
    }
  }

  @Get('*path')
  spa(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    if (req.url.startsWith('/api/')) {
      return reply.status(404).send({ statusCode: 404, message: 'Not found' });
    }
    if (this.indexHtml) {
      return reply.type('text/html').send(this.indexHtml);
    }
    return reply.status(404).send('Not found');
  }
}
