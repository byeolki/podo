import { Controller, Get, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Public } from './common/decorators/public.decorator';
import * as path from 'path';
import * as fs from 'fs';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

@Public()
@Controller()
export class FrontendController {
  private readonly staticDir: string;
  private readonly indexHtml: string | null = null;

  constructor(config: ConfigService) {
    this.staticDir = config.get<string>('static_dir', path.join(process.cwd(), 'public'));
    const indexPath = path.join(this.staticDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      this.indexHtml = fs.readFileSync(indexPath, 'utf-8');
    }
  }

  @Get('*')
  spa(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const url = req.url.split('?')[0];

    if (!url.startsWith('/api/')) {
      const filePath = path.join(this.staticDir, url);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] ?? 'application/octet-stream';
        if (ext === '.js' || ext === '.css') {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
        return reply.type(mime).send(fs.createReadStream(filePath));
      }

      if (this.indexHtml) {
        return reply.type('text/html').send(this.indexHtml);
      }
    }

    return reply.status(404).send({ statusCode: 404, message: 'Not found' });
  }
}
