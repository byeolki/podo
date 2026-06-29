import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
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

  @Get('*')
  spa(@Res() reply: FastifyReply) {
    if (this.indexHtml) {
      return reply.type('text/html').send(this.indexHtml);
    }
    return reply.status(404).send('Not found');
  }
}
