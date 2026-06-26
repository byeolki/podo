import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { Db, DB_TOKEN } from '../db/database.module';
import * as schema from '../db/schema';
import { newId } from '../common/id';
import { ScannerService } from './scanner.service';
import { WatcherService } from './watcher.service';

@Injectable()
export class LibraryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly scanner: ScannerService,
    private readonly watcher: WatcherService,
  ) {}

  async onApplicationBootstrap() {
    const configRoots = this.config.get<string[]>('library_roots', []);
    for (const rootPath of configRoots) {
      await this.addRoot(rootPath, false);
    }

    const roots = await this.db
      .select()
      .from(schema.library_roots)
      .where(eq(schema.library_roots.enabled, true));

    const paths = roots.map((r) => r.path);
    this.watcher.watch(paths);

    for (const root of roots) {
      this.logger.log(`Starting initial scan for ${root.path}`);
      void this.scanner.scanRoot(root.id, root.path);
    }
  }

  async listRoots() {
    return this.db.select().from(schema.library_roots);
  }

  async addRoot(rootPath: string, triggerScan = true) {
    const existing = await this.db
      .select()
      .from(schema.library_roots)
      .where(eq(schema.library_roots.path, rootPath))
      .get();

    let root: typeof schema.library_roots.$inferSelect;

    if (existing) {
      root = existing;
    } else {
      const id = newId();
      await this.db.insert(schema.library_roots).values({ id, path: rootPath });
      root = (await this.db.select().from(schema.library_roots).where(eq(schema.library_roots.id, id)).get())!;
    }

    this.watcher.addPath(rootPath);

    if (triggerScan) {
      await this.scanner.scanRoot(root.id, rootPath);
    }

    return root;
  }

  async removeRoot(id: string) {
    const root = await this.db.select().from(schema.library_roots).where(eq(schema.library_roots.id, id)).get();
    if (!root) throw new NotFoundException('Library root not found');

    this.watcher.removePath(root.path);
    await this.db.delete(schema.library_roots).where(eq(schema.library_roots.id, id));
  }

  async triggerScan(id: string): Promise<string> {
    const root = await this.db.select().from(schema.library_roots).where(eq(schema.library_roots.id, id)).get();
    if (!root) throw new NotFoundException('Library root not found');
    return this.scanner.scanRoot(root.id, root.path);
  }

  async getScanJob(jobId: string) {
    return this.db.select().from(schema.scan_jobs).where(eq(schema.scan_jobs.id, jobId)).get();
  }

  async listScanJobs() {
    return this.db.select().from(schema.scan_jobs).orderBy(schema.scan_jobs.started_at);
  }
}
