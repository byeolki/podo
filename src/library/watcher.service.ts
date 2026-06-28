import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import * as chokidar from 'chokidar';
import { ScannerService } from './scanner.service';

@Injectable()
export class WatcherService implements OnApplicationShutdown {
  private readonly logger = new Logger(WatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;

  constructor(private readonly scanner: ScannerService) {}

  watch(paths: string[]): void {
    if (this.watcher) {
      void this.watcher.close();
    }

    if (paths.length === 0) return;

    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
      ignored: /(^|[/\\])\../,
    });

    this.watcher
      .on('add', (filePath) => {
        this.logger.debug(`File added: ${filePath}`);
        void this.scanner.scanFile(filePath);
      })
      .on('change', (filePath) => {
        this.logger.debug(`File changed: ${filePath}`);
        void this.scanner.scanFile(filePath);
      })
      .on('unlink', (filePath) => {
        this.logger.debug(`File removed: ${filePath}`);
        void this.scanner.removeFile(filePath);
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          this.logger.debug(`Watcher skipping inaccessible path: ${err.path ?? err.message}`);
        } else {
          this.logger.warn(`Watcher error: ${err.message}`);
        }
      });

    this.logger.log(`Watching ${paths.length} path(s)`);
  }

  addPath(watchPath: string): void {
    if (this.watcher) {
      this.watcher.add(watchPath);
    } else {
      this.watch([watchPath]);
    }
  }

  removePath(watchPath: string): void {
    void this.watcher?.unwatch(watchPath);
  }

  async onApplicationShutdown() {
    await this.watcher?.close();
  }
}
