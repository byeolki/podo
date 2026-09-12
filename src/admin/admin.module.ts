import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { StreamingModule } from '../streaming/streaming.module';
import { UploadModule } from '../upload/upload.module';
import { LibraryModule } from '../library/library.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [StreamingModule, UploadModule, LibraryModule, AiModule],
  providers: [AdminService],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}
