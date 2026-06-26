import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { LibraryModule } from '../library/library.module';

@Module({
  imports: [LibraryModule],
  providers: [UploadService],
  controllers: [UploadController],
})
export class UploadModule {}
